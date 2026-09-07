import { createClient } from '@/lib/supabase/server'
import { sortRoute, DEFAULT_HUB } from '@/lib/rider/route-order'
import type { RiderJob } from '@/components/rider/job-card'

/**
 * Rider data reads.
 *
 * RLS does all the scoping. Since 0009 `orders_read_rider` is simply
 * `rider_id = auth.uid()`: the offer branch went with the offer engine, so a
 * rider sees exactly the parcels they are carrying. No `.eq('rider_id', ...)`
 * filters appear here — adding them would imply the filter is what protects the
 * data. It is not.
 */

const JOB_COLUMNS = `
  id, code, status, pickup_address, pickup_lat, pickup_lng, pickup_contact, pickup_note,
  customer_name, customer_phone, customer_phone_alt,
  dropoff_address, dropoff_area_id, dropoff_lat, dropoff_lng, dropoff_note,
  parcel_desc, parcel_weight_g, is_fragile, payment_method, cod_amount, fee_payer, delivery_fee,
  rider_commission_amount, route_distance_km, rider_id, delivered_at, proof_photo_path,
  trip_id, trip_leg,
  shops:shop_id (name, phone),
  dropoff_area:dropoff_area_id (name)
` as const

export type RawJob = {
  id: string
  code: string
  status: RiderJob['status']
  pickup_address: string
  pickup_lat: number
  pickup_lng: number
  pickup_contact: string | null
  pickup_note: string | null
  customer_name: string
  customer_phone: string
  customer_phone_alt: string | null
  dropoff_address: string
  dropoff_area_id: string | null
  dropoff_lat: number
  dropoff_lng: number
  dropoff_note: string | null
  parcel_desc: string
  parcel_weight_g: number | null
  is_fragile: boolean
  payment_method: 'cod' | 'prepaid'
  cod_amount: number
  fee_payer: string
  /** Needed to show WHY the total is what it is — cod_amount already includes it. */
  delivery_fee: number
  rider_commission_amount: number | null
  route_distance_km: number | null
  rider_id: string | null
  delivered_at: string | null
  proof_photo_path: string | null
  trip_id: string | null
  trip_leg: 'delivery' | 'pickup' | 'return' | null
  shops: { name: string; phone: string } | null
  dropoff_area: { name: string } | null
}

function toJob(row: RawJob, extra?: Partial<RiderJob>): RiderJob {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    shopName: row.shops?.name ?? null,
    pickupAddress: row.pickup_address,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    dropoffAddress: row.dropoff_address,
    dropoffArea: row.dropoff_area?.name ?? null,
    dropoffLat: row.dropoff_lat,
    dropoffLng: row.dropoff_lng,
    parcelDesc: row.parcel_desc,
    isFragile: row.is_fragile,
    paymentMethod: row.payment_method,
    codAmount: row.cod_amount,
    commission: row.rider_commission_amount,
    routeKm: row.route_distance_km,
    leg: row.trip_leg,
    /*
      BOTH LEGS THAT END AT THE SHOP FLIP, and until now only one of them did.

        return : carried BACK to the shop after resolution='return'
        pickup : collected FROM the shop and carried to the hub

      Only 'return' was handled, so every pickup-leg parcel showed the
      CUSTOMER's address, called the customer, and sent Directions to the
      customer — for a job whose entire content is "go to the shop". It has gone
      unnoticed because no pickup leg has been loaded in production yet.

      The shop's pickup point is already on the order; nothing new is needed.
    */
    ...(row.trip_leg === 'return' || row.trip_leg === 'pickup'
      ? {
          dropoffAddress: row.pickup_address,
          dropoffArea: null,
          // The map link and the CALL button must point at the shop too, or a
          // rider taps Directions and is sent to the customer they just failed.
          dropoffLat: row.pickup_lat,
          dropoffLng: row.pickup_lng,
          customerName: row.shops?.name ?? 'the shop',
          customerPhone: row.shops?.phone ?? row.customer_phone,
        }
      : null),
    ...extra,
  }
}

/** The run the rider is on, if any. Replaces the offer feed. */
export type RiderTrip = {
  id: string
  routeCode: string
  routeName: string
  routeNameMm: string | null
  colour: string
  status: 'planned' | 'loading' | 'departed' | 'returned' | 'closed' | 'cancelled'
  serviceDate: string
  departedAt: string | null
  /** area id -> stop sequence, used to order the manifest. */
  stopOrder: Record<string, number>
}

export type RiderFeed = {
  active: RiderJob[]
  /**
   * The two per-unit trip rates, for showing a rider what a stop adds.
   *
   * NOT the whole of a run's pay: `quote_trip_pay` picks its tier by DELIVERY
   * count, so a collection-only run of ten pickups is `base 15,000 + 5,000`.
   * The base belongs to the run and cannot be split between shops, which is why
   * a collection card can only honestly claim its own pickup component.
   */
  rates: { parcelRate: number; pickupRate: number }
  /**
   * The SHOP's coordinates, keyed by `collectionKey(job)`.
   *
   * `RiderJob` deliberately carries one coordinate pair, already flipped for
   * the leg, so a collection group has no way to reach the shop's own point —
   * which is why `planCollections` takes a `pickupPointFor` callback and gives
   * a group NO Directions link rather than one to the customer. This is that
   * callback's source. `JOB_COLUMNS` already selects pickup_lat/lng; they were
   * being read and thrown away.
   */
  pickupPoints: Record<string, { lat: number; lng: number }>
  trip: RiderTrip | null
  profile: {
    isOnline: boolean
    availability: 'available' | 'busy'
    activeCount: number
    maxActive: number
    coverageKm: number
    baseArea: string | null
    lastPingAt: string | null
  } | null
  earnings: {
    codInHand: number
    earnedToday: number
    earnedWeek: number
    deliveredToday: number
    /** Collection legs completed today — the other half of a rider's output. */
    pickedUpToday: number
    activeOrders: number
    /** Of `earnedToday`, the part that came from closed route runs. */
    tripPayToday: number
  }
}

export async function getRiderFeed(riderId: string): Promise<RiderFeed> {
  const supabase = await createClient()

  const [{ data: rows }, { data: tripRow }, { data: profile }, { data: summary }, { data: settings }] =
    await Promise.all([
      supabase
        .from('orders')
        .select(JOB_COLUMNS)
        .in('status', ['assigned', 'picked_up'])
        /*
          THE FEED IS THE CURRENT RUN. Without this a collected pickup haunts
          the rider forever: close_trip detaches it (trip_id null) but it stays
          `picked_up` and keeps its rider_id -- it must, because
          orders_assigned_needs_rider forbids a rider-less parcel in any state
          but pending or cancelled. Status and rider both still matched, so the
          parcel reappeared as a stop on every later run, now with leg null and
          therefore showing the CUSTOMER's address for a job that was finished.

          Safe as a filter because every rider assignment goes through a trip:
          the offer engine was retired in 0009 and `orders.rider_id` is now
          written only by assign_trip_rider, load_trip and depart_trip.
        */
        .not('trip_id', 'is', null)
        .order('created_at', { ascending: true }),
      // The open run, if there is one. trips_rider_open_uk guarantees at most one.
      supabase
        .from('trips')
        .select(
          `id, status, service_date, departed_at, route_id,
           routes:route_id (code, name, name_mm, colour, hub_lat, hub_lng)`,
        )
        .in('status', ['planned', 'loading', 'departed', 'returned'])
        .order('service_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('rider_profiles')
        .select(
          `is_online, availability, active_order_count, max_active_orders, coverage_km, last_ping_at,
           service_areas!rider_profiles_base_area_id_fkey (name)`,
        )
        .eq('id', riderId)
        .maybeSingle(),
      supabase.rpc('rider_earnings_summary'),
      /*
        The two per-unit trip rates, so a collection card can say what the stop
        adds. A rider CAN read these -- `settings_read_all` grants SELECT on
        app_settings to `authenticated` -- and nothing rider-side fetched them
        before, which is why the app has never shown a rider a rate.
      */
      supabase
        .from('app_settings')
        .select('route_parcel_rate, route_pickup_rate')
        .eq('id', true)
        .maybeSingle(),
    ])

  // Stop order comes from the ROUTE, not the order, so a dispatcher reordering
  // stops reorders the rider's list without touching a single parcel.
  let stopOrder: Record<string, number> = {}
  if (tripRow?.route_id) {
    const { data: stops } = await supabase
      .from('route_areas')
      .select('area_id, stop_order')
      .eq('route_id', tripRow.route_id)
    stopOrder = Object.fromEntries((stops ?? []).map((s) => [s.area_id, s.stop_order]))
  }

  const all = (rows ?? []) as unknown as RawJob[]

  const route = tripRow?.routes as unknown as
    | {
        code: string
        name: string
        name_mm: string | null
        colour: string
        hub_lat: number
        hub_lng: number
      }
    | null

  // The run's own hub if it has one, else Thingangyun. `routes_hub_in_service_area`
  // guarantees a real point, so there is nothing to validate here.
  const hub =
    route && Number.isFinite(route.hub_lat) && Number.isFinite(route.hub_lng)
      ? { lat: route.hub_lat, lng: route.hub_lng }
      : DEFAULT_HUB

  /**
   * Ordered by the drive, not by the dispatcher's area list.
   *
   * `route_areas.stop_order` is a per-AREA sequence maintained by hand; it cannot
   * know which parcels are on today's bike or where within an area they sit.
   * `sortRoute` measures the actual destinations from the hub: deliveries
   * outwards, then collections back in, so the day ends beside the hub rather
   * than at the far edge of the city holding all the cash. The area's own stop
   * number is still carried on the card.
   *
   * A return's destination is the SHOP, which is why the flip happens here and
   * not inside sortRoute.
   */
  const active = sortRoute(
    all.map((r) => ({
      ...toJob(r, { stopOrder: stopOrder[r.dropoff_area_id ?? ''] ?? null }),
      leg: r.trip_leg,
      // Same rule as toJob above: a pickup leg is measured to the SHOP, not to
      // a customer it never visits. Getting this wrong put collections in the
      // drive order by an address the rider will never go to.
      destination:
        r.trip_leg === 'return' || r.trip_leg === 'pickup'
          ? { lat: r.pickup_lat, lng: r.pickup_lng }
          : { lat: r.dropoff_lat, lng: r.dropoff_lng },
    })),
    hub,
  ).map(({ destination: _destination, hubKm, stopNumber, ...job }) => ({
    ...job,
    hubKm,
    stopNumber,
  }))

  const s = (summary ?? {}) as Record<string, number | string | null>

  // Built off the raw rows, before toJob flips the coordinates for a leg.
  // Same normalisation `collectionKey` uses, so the two agree by construction.
  const pickupPoints: Record<string, { lat: number; lng: number }> = {}
  for (const row of all) {
    if (!Number.isFinite(row.pickup_lat) || !Number.isFinite(row.pickup_lng)) continue
    pickupPoints[row.pickup_address.trim().toLowerCase()] ??= {
      lat: row.pickup_lat,
      lng: row.pickup_lng,
    }
  }

  return {
    active,
    rates: {
      // The 0007 defaults, so a failed settings read degrades to the shipped
      // numbers rather than telling a rider a collection is worth nothing.
      parcelRate: Number(settings?.route_parcel_rate ?? 300),
      pickupRate: Number(settings?.route_pickup_rate ?? 500),
    },
    pickupPoints,
    trip:
      tripRow && route
        ? {
            id: tripRow.id,
            routeCode: route.code,
            routeName: route.name,
            routeNameMm: route.name_mm,
            colour: route.colour,
            status: tripRow.status as RiderTrip['status'],
            serviceDate: tripRow.service_date,
            departedAt: tripRow.departed_at,
            stopOrder,
          }
        : null,
    profile: profile
      ? {
          isOnline: profile.is_online,
          availability: profile.availability,
          activeCount: profile.active_order_count,
          maxActive: profile.max_active_orders,
          coverageKm: Number(profile.coverage_km),
          baseArea: (profile.service_areas as { name: string } | null)?.name ?? null,
          lastPingAt: profile.last_ping_at,
        }
      : null,
    earnings: {
      codInHand: Number(s.cod_in_hand ?? 0),
      earnedToday: Number(s.earned_today ?? 0),
      earnedWeek: Number(s.earned_week ?? 0),
      deliveredToday: Number(s.delivered_today ?? 0),
      pickedUpToday: Number(s.picked_up_today ?? 0),
      activeOrders: Number(s.active_orders ?? 0),
      tripPayToday: Number(s.trip_pay_today ?? 0),
    },
  }
}

export async function getRiderJob(orderId: string, riderId: string) {
  const supabase = await createClient()

  // RLS returns nothing unless the parcel is this rider's, so a miss is a 404 and
  // needs no ownership check here. `riderId` stays in the signature because the
  // caller has it and a future per-rider read may need it again.
  void riderId

  const { data: row } = await supabase
    .from('orders')
    .select(JOB_COLUMNS)
    .eq('id', orderId)
    .maybeSingle()

  if (!row) return null
  const raw = row as unknown as RawJob

  return { job: toJob(raw), raw }
}

/**
 * The office's KBZPay account, for the QR the rider shows a customer.
 *
 * `app_settings` is readable by every authenticated role, so no RPC is needed.
 * Falls back to the static path rather than throwing: a rider who cannot see the
 * account name can still show the QR, and a delivery must never be blocked by a
 * settings read.
 */
export async function getKpayAccount(): Promise<{
  name: string | null
  phone: string | null
  qrUrl: string
}> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('app_settings')
    .select('kpay_account_name, kpay_phone, kpay_qr_url')
    .eq('id', true)
    .maybeSingle()

  return {
    name: data?.kpay_account_name ?? null,
    phone: data?.kpay_phone ?? null,
    qrUrl: data?.kpay_qr_url ?? '/kpay-qr.png',
  }
}
