import { createClient } from '@/lib/supabase/server'
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
  parcel_desc, parcel_weight_g, is_fragile, payment_method, cod_amount, fee_payer,
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
  rider_commission_amount: number | null
  route_distance_km: number | null
  rider_id: string | null
  delivered_at: string | null
  proof_photo_path: string | null
  trip_id: string | null
  trip_leg: 'delivery' | 'pickup' | null
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
    parcelDesc: row.parcel_desc,
    isFragile: row.is_fragile,
    paymentMethod: row.payment_method,
    codAmount: row.cod_amount,
    commission: row.rider_commission_amount,
    routeKm: row.route_distance_km,
    leg: row.trip_leg,
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
    activeOrders: number
    /** Of `earnedToday`, the part that came from closed route runs. */
    tripPayToday: number
  }
}

export async function getRiderFeed(riderId: string): Promise<RiderFeed> {
  const supabase = await createClient()

  const [{ data: rows }, { data: tripRow }, { data: profile }, { data: summary }] =
    await Promise.all([
      supabase
        .from('orders')
        .select(JOB_COLUMNS)
        .in('status', ['assigned', 'picked_up'])
        .order('created_at', { ascending: true }),
      // The open run, if there is one. trips_rider_open_uk guarantees at most one.
      supabase
        .from('trips')
        .select(
          `id, status, service_date, departed_at, route_id,
           routes:route_id (code, name, name_mm, colour)`,
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

  const active = all
    .map((r) => toJob(r, { stopOrder: stopOrder[r.dropoff_area_id ?? ''] ?? null }))
    .sort((a, b) => {
      // Manifest order along the run, then code so the list is stable.
      const sa = a.stopOrder ?? 9999
      const sb = b.stopOrder ?? 9999
      return sa - sb || a.code.localeCompare(b.code)
    })

  const s = (summary ?? {}) as Record<string, number | string | null>
  const route = tripRow?.routes as unknown as
    | { code: string; name: string; name_mm: string | null; colour: string }
    | null

  return {
    active,
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
