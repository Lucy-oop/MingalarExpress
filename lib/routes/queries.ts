import { createClient } from '@/lib/supabase/server'
import { planningFeeByRoute } from '@/lib/routes/planning-fee'
import {
  checkTripVolume,
  MIN_PARCELS_PER_TRIP,
  type RoutePayTier,
  type TripPayRates,
  type TripVolumeCheck,
} from '@/lib/pricing'

/**
 * Reads for the route planning board.
 *
 * One page, one round of queries. The board shows every route's runs for a day
 * alongside the parcels that are not on a run yet, and a dispatcher works across
 * both halves constantly — so they are fetched together and the whole page is
 * `force-dynamic`. A cached planning board is a double-loading generator, the
 * same reason the old dispatch queue was never cached.
 *
 * RLS does the scoping (`trips_read_own_or_dispatch`, `orders_all_dispatch`).
 * No `.eq('...')` guards appear here; adding them would imply the filter is what
 * protects the data.
 */

export type BoardRoute = {
  id: string
  code: string
  name: string
  nameMm: string | null
  colour: string
  perParcelFee: number
  maxParcels: number
  maxCod: number
  payModel: 'trip' | 'per_parcel'
  sortOrder: number
  /** Areas this route serves, in stop order — the rider's manifest sequence. */
  stops: Array<{ areaId: string; name: string; stopOrder: number; isPrimary: boolean }>
}

export type BoardTripParcel = {
  id: string
  code: string
  status: string
  leg: 'delivery' | 'pickup' | 'return'
  customerName: string
  dropoffAddress: string
  areaName: string | null
  areaId: string | null
  stopOrder: number | null
  codAmount: number
  deliveryFee: number
  paymentMethod: 'cod' | 'prepaid'
}

export type BoardTrip = {
  id: string
  routeId: string
  serviceDate: string
  status: 'planned' | 'loading' | 'departed' | 'returned' | 'closed' | 'cancelled'
  riderId: string | null
  riderName: string | null
  departedAt: string | null
  returnedAt: string | null
  closedAt: string | null
  departOverrideReason: string | null
  totalPay: number
  parcels: BoardTripParcel[]
  /** Live counts — what is on the bike now, not the closed snapshot. */
  parcelCount: number
  pickupCount: number
  codTotal: number
  /** Drives TripVolumeBanner and TripVolumePill. */
  volume: TripVolumeCheck
}

export type UnroutedParcel = {
  id: string
  code: string
  status: string
  customerName: string
  customerPhone: string
  dropoffAddress: string
  areaId: string | null
  areaName: string | null
  areaKind: 'ward' | 'township' | null
  /** Route this parcel's area maps to by default, from route_areas.is_primary. */
  suggestedRouteId: string | null
  codAmount: number
  deliveryFee: number
  paymentMethod: 'cod' | 'prepaid'
  parcelDesc: string
  isFragile: boolean
  createdAt: string
  /**
   * Where a COLLECTION run goes. A parcel's dropoff area is meaningless for
   * the inbound half of the operation — a rider collecting parcels visits
   * shops, not townships.
   */
  pickupAddress: string
  shopName: string | null
}

export type BoardRider = {
  id: string
  name: string
  phone: string | null
  isOnline: boolean
  vehiclePlate: string | null
  baseArea: string | null
  /** Unsettled ledger balance. Positive = holding the platform's cash. */
  codInHand: number
  codFloatLimit: number
  /** True while this rider is already out on a planned/loading/departed run. */
  onOpenTrip: boolean
}

export type PlanningBoard = {
  serviceDate: string
  minParcels: number
  /** Parcels the shop asked to have brought back. Not deliverable. */
  returns: UnroutedParcel[]
  /** Parcels stopped at the attempt cap, waiting on their shop to decide. */
  stalled: UnroutedParcel[]
  /**
   * Collected from a shop and sitting at the hub, waiting to go out. Loadable
   * onto a DELIVERY leg only — 0027 refuses them to a pickup leg, because
   * fetching what we already hold sends a rider across Yangon for nothing.
   */
  hubHeld: UnroutedParcel[]
  rates: TripPayRates
  tiers: RoutePayTier[]
  routes: BoardRoute[]
  trips: BoardTrip[]
  unrouted: UnroutedParcel[]
  riders: BoardRider[]
}

const TRIP_ORDER_COLUMNS = `
  id, code, status, trip_id, trip_leg, customer_name, dropoff_address,
  pickup_address, dropoff_area_id, cod_amount, delivery_fee, payment_method,
  dropoff_area:dropoff_area_id (name)
` as const

const UNROUTED_COLUMNS = `
  id, code, status, customer_name, customer_phone, dropoff_address,
  dropoff_area_id, cod_amount, delivery_fee, payment_method, parcel_desc,
  is_fragile, created_at, pickup_address,
  dropoff_area:dropoff_area_id (name, kind),
  shops:shop_id (name)
` as const

/** Yangon is UTC+06:30 with no DST, so a fixed offset is exact, not an estimate. */
export function yangonToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 6.5 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export async function getPlanningBoard(serviceDate?: string): Promise<PlanningBoard> {
  const supabase = await createClient()
  const day = serviceDate ?? yangonToday()

  const [
    { data: routeRows, error: routeErr },
    { data: areaRows },
    { data: tripRows, error: tripErr },
    { data: settings },
    { data: tierRows },
  ] = await Promise.all([
    supabase
      .from('routes')
      .select(
        'id, code, name, name_mm, colour, per_parcel_fee, max_parcels_per_trip, max_cod_per_trip, pay_model, sort_order',
      )
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('route_areas')
      .select(
        'route_id, area_id, stop_order, is_primary, service_areas:area_id (name, kind, delivery_zones:zone_id (fee))',
      )
      .order('stop_order', { ascending: true }),
    supabase
      .from('trips')
      .select(
        `id, route_id, service_date, status, rider_id, departed_at, returned_at, closed_at,
         depart_override_reason, total_pay,
         rider:rider_id (profiles!rider_profiles_id_fkey (full_name))`,
      )
      // Closed and cancelled runs are excluded from the board on purpose: a
      // board that accumulates finished work stops being a work surface. They
      // remain in the ledger and in /admin/audit.
      .in('status', ['planned', 'loading', 'departed', 'returned'])
      .order('service_date', { ascending: false }),
    supabase
      .from('app_settings')
      .select('route_parcel_rate, route_pickup_rate, min_parcels_per_trip')
      .maybeSingle(),
    supabase.from('route_pay_tiers').select('id, route_id, min_parcels, max_parcels, base_pay'),
  ])

  if (routeErr) throw new Error(`routes unavailable: ${routeErr.message}`)
  if (tripErr) throw new Error(`trips unavailable: ${tripErr.message}`)

  const tripIds = (tripRows ?? []).map((t) => t.id)

  const [
    { data: tripOrderRows },
    { data: unroutedRows, error: unroutedErr },
    { data: returnRows },
    { data: stalledRows },
    { data: hubHeldRows },
    riders,
  ] = await Promise.all([
      tripIds.length
        ? supabase.from('orders').select(TRIP_ORDER_COLUMNS).in('trip_id', tripIds)
        : Promise.resolve({ data: [] as unknown[] }),
      // The deliverable pool. Three exclusions worth stating, because getting
      // any of them wrong puts a parcel on a bike that should not be on one:
      //
      //  status = 'pending' only  — a detached `failed` parcel is one 0011 held
      //    back at the attempt cap. It is waiting on the SHOP, not on dispatch,
      //    and offering it here would restart the silent retry loop the cap
      //    exists to stop. Retries the shop approves come back as `pending`.
      //  resolution <> 'return'   — the shop asked for it back. It must not be
      //    loaded for delivery again, whatever its status says.
      //  trip_id is null          — already on a run.
      supabase
        .from('orders')
        .select(UNROUTED_COLUMNS)
        .is('trip_id', null)
        .eq('status', 'pending')
        // 0028: still on the shop's shelf. Anything already collected belongs
        // in the hub pool below and can only go OUT.
        .is('picked_up_at', null)
        .or('resolution.is.null,resolution.eq.retry')
        .order('created_at', { ascending: true })
        .limit(500),
      // Parcels the shop has asked back. Not deliverable, but dispatch has to
      // see them or nobody ever carries them home.
      supabase
        .from('orders')
        .select(UNROUTED_COLUMNS)
        .eq('resolution', 'return')
        // `returned` joins the exclusion list in 0013 — without it a parcel that
        // has already been carried home sits in this pool forever, and dispatch
        // keeps being told to return something that is back on the shop's shelf.
        .not('status', 'in', '(cancelled,delivered,returned)')
        .order('resolved_at', { ascending: true })
        .limit(200),
      // Parcels stopped at the attempt cap, waiting on their shop. Dispatch
      // cannot act on these, but a board that hides them hides work that has
      // silently stalled.
      supabase
        .from('orders')
        .select(UNROUTED_COLUMNS)
        .is('trip_id', null)
        .eq('status', 'failed')
        .is('resolution', null)
        .order('created_at', { ascending: true })
        .limit(200),
      /*
        ON THE HUB SHELF: collected from a shop, carried in, and now waiting for
        a delivery run. `close_trip` detaches a finished pickup leg but leaves
        the status at `picked_up`, which matched none of the three pools above
        -- so the parcel was physically in the building and invisible on this
        board, with `load_trip` refusing it as well. That is the black hole 0027
        closes, and this is the query that makes it visible.
      */
      supabase
        .from('orders')
        .select(UNROUTED_COLUMNS)
        .is('trip_id', null)
        // 0028: keyed on picked_up_at, not on status. A delivery that failed
        // with attempts left comes back as `pending` — but it is at the hub,
        // not at the shop, and sending a rider to collect it again would be
        // the whole bug this rule exists to prevent.
        .not('picked_up_at', 'is', null)
        .in('status', ['pending', 'picked_up'])
        .or('resolution.is.null,resolution.eq.retry')
        .order('picked_up_at', { ascending: true })
        .limit(200),
      getBoardRiders(),
    ])

  if (unroutedErr) throw new Error(`unrouted parcels unavailable: ${unroutedErr.message}`)

  const rates: TripPayRates = {
    parcelRate: Number(settings?.route_parcel_rate ?? 300),
    pickupRate: Number(settings?.route_pickup_rate ?? 500),
  }
  const minParcels = Number(settings?.min_parcels_per_trip ?? MIN_PARCELS_PER_TRIP)

  const tiers: RoutePayTier[] = (tierRows ?? []).map((t) => ({
    routeId: t.route_id,
    minParcels: t.min_parcels,
    maxParcels: t.max_parcels,
    basePay: Number(t.base_pay),
  }))

  // area → stop order, per route. Also gives each unrouted parcel its default run.
  const stopsByRoute = new Map<string, BoardRoute['stops']>()
  const primaryRouteByArea = new Map<string, string>()
  const stopOrderByRouteArea = new Map<string, number>()

  // route → the lowest zone fee among the areas it actually serves.
  const minZoneFeeByRoute = planningFeeByRoute(areaRows ?? [])

  for (const row of areaRows ?? []) {
    const area = row.service_areas as unknown as { name: string; kind: string } | null
    const list = stopsByRoute.get(row.route_id) ?? []
    list.push({
      areaId: row.area_id,
      name: area?.name ?? 'Unknown area',
      stopOrder: row.stop_order,
      isPrimary: row.is_primary,
    })
    stopsByRoute.set(row.route_id, list)
    stopOrderByRouteArea.set(`${row.route_id}:${row.area_id}`, row.stop_order)
    if (row.is_primary) primaryRouteByArea.set(row.area_id, row.route_id)
  }

  const routes: BoardRoute[] = (routeRows ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    nameMm: r.name_mm,
    colour: r.colour,
    perParcelFee: Number(r.per_parcel_fee),
    maxParcels: r.max_parcels_per_trip,
    maxCod: Number(r.max_cod_per_trip),
    payModel: r.pay_model as 'trip' | 'per_parcel',
    sortOrder: r.sort_order,
    stops: (stopsByRoute.get(r.id) ?? []).sort((a, b) => a.stopOrder - b.stopOrder),
  }))

  /*
    WHAT A RUN EARNS US, for the profitability pill and the break-even banner.

    From the ZONES the route serves, not from `routes.per_parcel_fee` — 0033
    moved the customer price to the zone, and reading the route's own figure
    left this understating a ROUTE_LOCAL run by 1,500 Ks a parcel: 50,000 Ks
    shown against 80,000 actually billed on a 20-parcel run, with break-even
    reported as 7 parcels instead of 5. A dispatcher would have held back runs
    that were comfortably profitable.

    THE LOWEST FEE, not the average. A route can span bands — Route C reaching
    both a 4,000 Ks township and a 5,000 Ks industrial pocket is the case 0033
    exists for — so no single number is exactly right, and the two directions of
    error are not equal. Understating sends a profitable run out with a warning
    on it; overstating sends an unprofitable one out with none. Take the
    pessimistic one.

    Falls back to the route's own fee only when the route serves no primary area
    at all, which is a route nothing can be dispatched to anyway.
  */
  const feeByRoute = new Map(
    routes.map((r) => [r.id, minZoneFeeByRoute.get(r.id) ?? r.perParcelFee]),
  )

  // Parcels per trip, sequenced by the route's stop order so the list on screen
  // is the order the rider will actually drive.
  const parcelsByTrip = new Map<string, BoardTripParcel[]>()
  for (const raw of (tripOrderRows ?? []) as unknown as Array<Record<string, unknown>>) {
    const tripId = raw.trip_id as string
    const areaId = (raw.dropoff_area_id as string | null) ?? null
    const trip = (tripRows ?? []).find((t) => t.id === tripId)
    const list = parcelsByTrip.get(tripId) ?? []
    list.push({
      id: raw.id as string,
      code: raw.code as string,
      status: raw.status as string,
      leg: ((raw.trip_leg as string) ?? 'delivery') as BoardTripParcel['leg'],
      customerName: raw.customer_name as string,
      // A return travels to the SHOP, so the address the rider needs is the
      // pickup point, not the customer's.
      dropoffAddress:
        raw.trip_leg === 'return'
          ? (raw.pickup_address as string)
          : (raw.dropoff_address as string),
      areaId,
      areaName:
        (raw.dropoff_area as { name: string } | null)?.name ?? null,
      stopOrder:
        trip && areaId ? stopOrderByRouteArea.get(`${trip.route_id}:${areaId}`) ?? null : null,
      codAmount: Number(raw.cod_amount ?? 0),
      deliveryFee: Number(raw.delivery_fee ?? 0),
      paymentMethod: raw.payment_method as 'cod' | 'prepaid',
    })
    parcelsByTrip.set(tripId, list)
  }

  const openTripRiders = new Set(
    (tripRows ?? [])
      .filter((t) => ['planned', 'loading', 'departed'].includes(t.status) && t.rider_id)
      .map((t) => t.rider_id as string),
  )

  const trips: BoardTrip[] = (tripRows ?? []).map((t) => {
    const parcels = (parcelsByTrip.get(t.id) ?? []).sort((a, b) => {
      const sa = a.stopOrder ?? 9999
      const sb = b.stopOrder ?? 9999
      return sa - sb || a.code.localeCompare(b.code)
    })
    // Cancelled parcels are excluded, matching depart_trip() and close_trip().
    const live = parcels.filter((p) => p.status !== 'cancelled')
    const parcelCount = live.filter((p) => p.leg === 'delivery').length
    const pickupCount = live.filter((p) => p.leg === 'pickup').length

    return {
      id: t.id,
      routeId: t.route_id,
      serviceDate: t.service_date,
      status: t.status as BoardTrip['status'],
      riderId: t.rider_id,
      riderName:
        (t.rider as unknown as { profiles: { full_name: string } | null } | null)?.profiles
          ?.full_name ?? null,
      departedAt: t.departed_at,
      returnedAt: t.returned_at,
      closedAt: t.closed_at,
      departOverrideReason: t.depart_override_reason,
      totalPay: Number(t.total_pay ?? 0),
      parcels,
      parcelCount,
      pickupCount,
      codTotal: live.reduce((sum, p) => sum + p.codAmount, 0),
      // Pickups are deliberately not part of the volume rule: depart_trip()
      // counts delivery legs only, and the banner must warn at exactly the count
      // the gate enforces.
      volume: checkTripVolume(
        parcelCount,
        feeByRoute.get(t.route_id) ?? 0,
        tiers,
        rates,
        t.route_id,
        minParcels,
      ),
    }
  })

  const toParcels = (rows: unknown): UnroutedParcel[] =>
    ((rows ?? []) as Array<Record<string, unknown>>).map((raw) => {
      const areaId = (raw.dropoff_area_id as string | null) ?? null
      const area = raw.dropoff_area as { name: string; kind: string } | null
      return {
        id: raw.id as string,
        code: raw.code as string,
        status: raw.status as string,
        customerName: raw.customer_name as string,
        customerPhone: raw.customer_phone as string,
        dropoffAddress: raw.dropoff_address as string,
        areaId,
        areaName: area?.name ?? null,
        areaKind: (area?.kind as 'ward' | 'township' | undefined) ?? null,
        suggestedRouteId: areaId ? primaryRouteByArea.get(areaId) ?? null : null,
        codAmount: Number(raw.cod_amount ?? 0),
        deliveryFee: Number(raw.delivery_fee ?? 0),
        paymentMethod: raw.payment_method as 'cod' | 'prepaid',
        parcelDesc: raw.parcel_desc as string,
        isFragile: Boolean(raw.is_fragile),
        createdAt: raw.created_at as string,
        pickupAddress: (raw.pickup_address as string) ?? '',
        shopName: (raw.shops as { name: string } | null)?.name ?? null,
      }
    })

  const unrouted = toParcels(unroutedRows)

  return {
    serviceDate: day,
    minParcels,
    rates,
    tiers,
    routes,
    trips,
    unrouted,
    returns: toParcels(returnRows),
    stalled: toParcels(stalledRows),
    hubHeld: toParcels(hubHeldRows),
    riders: riders.map((r) => ({ ...r, onOpenTrip: openTripRiders.has(r.id) })),
  }
}

/**
 * Every rider a dispatcher may put on a run, with their live cash position.
 *
 * Deliberately NOT filtered to "online": the board has to be able to explain why
 * the obvious rider cannot take a run, and a rider who is simply absent from the
 * list explains nothing. That was true of the old rank list and is still true.
 */
async function getBoardRiders(): Promise<Omit<BoardRider, 'onOpenTrip'>[]> {
  const supabase = await createClient()

  const [{ data: riders, error }, { data: ledger }] = await Promise.all([
    // Embeds are disambiguated by CONSTRAINT NAME, not by column: several tables
    // point at rider_profiles, so a bare `profiles:id (...)` embed fails.
    supabase
      .from('rider_profiles')
      .select(
        `id, is_online, vehicle_plate, cod_float_limit,
         profiles!rider_profiles_id_fkey (full_name, phone, is_active),
         service_areas!rider_profiles_base_area_id_fkey (name)`,
      )
      .order('is_online', { ascending: false }),
    supabase.from('cod_ledger').select('rider_id, amount').is('settlement_id', null),
  ])

  if (error) throw new Error(`riders unavailable: ${error.message}`)

  const cash = new Map<string, number>()
  for (const row of ledger ?? []) {
    cash.set(row.rider_id, (cash.get(row.rider_id) ?? 0) + row.amount)
  }

  return (riders ?? [])
    .filter((r) => (r.profiles as unknown as { is_active: boolean } | null)?.is_active !== false)
    .map((r) => {
      const p = r.profiles as unknown as { full_name: string; phone: string | null } | null
      return {
        id: r.id,
        name: p?.full_name ?? 'Unnamed rider',
        phone: p?.phone ?? null,
        isOnline: r.is_online,
        vehiclePlate: r.vehicle_plate,
        baseArea: (r.service_areas as unknown as { name: string } | null)?.name ?? null,
        codInHand: cash.get(r.id) ?? 0,
        codFloatLimit: Number(r.cod_float_limit ?? 0),
      }
    })
}
