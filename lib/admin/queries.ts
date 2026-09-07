import { createClient } from '@/lib/supabase/server'
import type { Functions, LedgerKind, ServiceArea, Settlement } from '@/types/domain'

export type AdminOverview = {
  riders_total: number
  riders_online: number
  riders_inactive: number
  shops_total: number
  shops_inactive: number
  areas_total: number
  orders_today: number
  delivered_today: number
  pending_now: number
  in_flight_now: number
  cod_outstanding: number
  fees_today: number
  rider_earnings_today: number
  settlements_open: number
  settlements_unpaid: number
  riders_over_float: number
}

export type CodPosition = Functions['cod_positions']['Returns'][number]
export type ShopPosition = Functions['cod_by_shop']['Returns'][number]

export async function getAdminOverview(): Promise<AdminOverview> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_overview')
  if (error) throw new Error(`overview unavailable: ${error.message}`)
  return data as unknown as AdminOverview
}

export type AdminRider = {
  id: string
  fullName: string
  phone: string | null
  isActive: boolean
  baseAreaId: string | null
  baseArea: string | null
  coverageKm: number
  maxActiveOrders: number
  codFloatLimit: number
  commissionPctOverride: number | null
  vehiclePlate: string | null
  isOnline: boolean
  availability: 'available' | 'busy'
  activeOrders: number
  lastPingAt: string | null
  createdAt: string
  codInHand: number
}

export async function getRiders(): Promise<AdminRider[]> {
  const supabase = await createClient()

  const [{ data: riders, error }, { data: positions }] = await Promise.all([
    supabase
      .from('rider_profiles')
      .select(
        `id, base_area_id, coverage_km, max_active_orders, cod_float_limit,
         commission_pct_override, vehicle_plate, is_online, availability,
         active_order_count, last_ping_at, created_at,
         profiles!rider_profiles_id_fkey (full_name, phone, is_active),
         service_areas!rider_profiles_base_area_id_fkey (name)`,
      )
      .order('created_at', { ascending: true }),
    supabase.rpc('cod_positions'),
  ])

  if (error) throw new Error(`riders unavailable: ${error.message}`)

  const cash = new Map(
    ((positions ?? []) as unknown as CodPosition[]).map((p) => [p.rider_id, p.open_balance]),
  )

  return (riders ?? []).map((r) => {
    const profile = r.profiles as unknown as {
      full_name: string
      phone: string | null
      is_active: boolean
    } | null
    return {
      id: r.id,
      fullName: profile?.full_name ?? 'Unknown',
      phone: profile?.phone ?? null,
      isActive: profile?.is_active ?? false,
      baseAreaId: r.base_area_id,
      baseArea: (r.service_areas as unknown as { name: string } | null)?.name ?? null,
      coverageKm: Number(r.coverage_km),
      maxActiveOrders: r.max_active_orders,
      codFloatLimit: r.cod_float_limit,
      commissionPctOverride:
        r.commission_pct_override === null ? null : Number(r.commission_pct_override),
      vehiclePlate: r.vehicle_plate,
      isOnline: r.is_online,
      availability: r.availability,
      activeOrders: r.active_order_count,
      lastPingAt: r.last_ping_at,
      createdAt: r.created_at,
      codInHand: cash.get(r.id) ?? 0,
    }
  })
}

// ---------------------------------------------------------------------------
// Delivery zones — the rate card
// ---------------------------------------------------------------------------

/**
 * One row of the rate card, with the two facts the office needs to judge it.
 *
 * `areaCount` is how much of the map this price covers. `waiting` is the part of
 * that which a shop still CANNOT book, and it is the more interesting number:
 * 0033 created 21 townships straight off the printed rate card and could not
 * invent their `route_areas` mapping, because which run visits Thanlyin is an
 * operational decision. They were inserted switched off for exactly that
 * reason, and this is the only screen that would ever say so.
 *
 * An area is bookable only when it is active AND has a primary route AND has an
 * active zone — the same three conditions `toAreaRoute` applies. Anything else
 * is priced but not sellable.
 */
export type ZoneRow = {
  id: string
  code: string
  name: string
  nameMm: string | null
  /** What a shop pays per parcel into this zone, in MMK. */
  fee: number
  deliveryDays: number
  sortOrder: number
  isActive: boolean
  /** Every area priced by this zone, sellable or not. */
  areaCount: number
  /**
   * Of those, how many are READY on the area side: switched on and on a route.
   *
   * Deliberately not zeroed when the zone itself is off, even though nothing in
   * an off zone is bookable. Collapsing both facts into one number produced a
   * row reading "0 of 24 bookable · 0 waiting", which invites the reader to
   * hunt for 24 broken areas that are all fine. The zone's own state is stated
   * separately, where it can be acted on.
   */
  bookableCount: number
  /**
   * The rest, named. Named rather than counted because an office cannot act on
   * a number, and each of these needs the same specific thing: a route.
   */
  waiting: Array<{ name: string; why: 'no route' | 'switched off' }>
}

export async function getDeliveryZones(): Promise<ZoneRow[]> {
  const supabase = await createClient()

  const [zones, areas, mapped] = await Promise.all([
    supabase
      .from('delivery_zones')
      .select('id, code, name, name_mm, fee, delivery_days, sort_order, is_active')
      .order('sort_order', { ascending: true }),
    // Inactive ones included on purpose — they are the ones worth reporting.
    supabase.from('service_areas').select('id, name, zone_id, is_active').order('name'),
    supabase.from('route_areas').select('area_id').eq('is_primary', true),
  ])

  if (zones.error) throw new Error(`zones unavailable: ${zones.error.message}`)
  if (areas.error) throw new Error(`areas unavailable: ${areas.error.message}`)
  if (mapped.error) throw new Error(`route mappings unavailable: ${mapped.error.message}`)

  const routed = new Set((mapped.data ?? []).map((r) => r.area_id))

  return (zones.data ?? []).map((z) => {
    const mine = (areas.data ?? []).filter((a) => a.zone_id === z.id)
    const waiting = mine
      .filter((a) => !a.is_active || !routed.has(a.id))
      .map((a) => ({
        name: a.name,
        // "No route" is the actionable one and outranks the switch: an area
        // that is off AND unrouted needs the route first, and saying "switched
        // off" would send an admin to flip a toggle that makes it bookable-
        // looking while still undispatchable.
        why: (!routed.has(a.id) ? 'no route' : 'switched off') as 'no route' | 'switched off',
      }))
    return {
      id: z.id,
      code: z.code,
      name: z.name,
      nameMm: z.name_mm,
      fee: Number(z.fee),
      deliveryDays: Number(z.delivery_days),
      sortOrder: Number(z.sort_order),
      isActive: z.is_active,
      areaCount: mine.length,
      bookableCount: mine.length - waiting.length,
      waiting,
    }
  })
}

/** Just enough to fill the zone selector on the ward form. */
export type ZoneChoice = { id: string; code: string; name: string; fee: number }

export async function getZoneChoices(): Promise<ZoneChoice[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('delivery_zones')
    .select('id, code, name, fee')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(`zones unavailable: ${error.message}`)
  return (data ?? []).map((z) => ({
    id: z.id,
    code: z.code,
    name: z.name,
    fee: Number(z.fee),
  }))
}

export async function getServiceAreas(): Promise<ServiceArea[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('service_areas')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw new Error(`areas unavailable: ${error.message}`)
  return (data ?? []) as ServiceArea[]
}

export async function getPricingSettings() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('app_settings').select('*').eq('id', true).single()
  if (error) throw new Error(`settings unavailable: ${error.message}`)
  return data
}

export type SettlementRow = Settlement & {
  rider: { full_name: string; phone: string | null } | null
}

export async function getSettlements(period?: string): Promise<SettlementRow[]> {
  const supabase = await createClient()
  let query = supabase
    .from('settlements')
    .select(`*, rider:rider_id (id)`)
    .order('period_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)

  if (period) query = query.eq('period_date', period)

  const { data, error } = await query
  if (error) throw new Error(`settlements unavailable: ${error.message}`)

  // The rider display name lives on `profiles`, which is two hops from
  // `settlements`. One extra query beats an ambiguous nested embed.
  const ids = [...new Set((data ?? []).map((s) => s.rider_id))]
  const names = new Map<string, { full_name: string; phone: string | null }>()
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, phone')
      .in('id', ids)
    for (const p of profiles ?? []) names.set(p.id, { full_name: p.full_name, phone: p.phone })
  }

  return (data ?? []).map((s) => ({
    ...(s as unknown as Settlement),
    rider: names.get(s.rider_id) ?? null,
  }))
}

export async function getSettlement(id: string) {
  const supabase = await createClient()

  const { data: settlement } = await supabase
    .from('settlements')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!settlement) return null

  const [{ data: profile }, { data: lines }] = await Promise.all([
    supabase.from('profiles').select('full_name, phone').eq('id', settlement.rider_id).maybeSingle(),
    supabase
      .from('cod_ledger')
      .select('id, kind, amount, memo, order_id, created_at')
      .eq('settlement_id', id)
      .order('created_at', { ascending: true }),
  ])

  // Resolve order codes in one extra round trip. A settlement detail with bare
  // UUIDs is unusable when an operator is reconciling against paper receipts,
  // which carry the MGE- code.
  const orderIds = [...new Set((lines ?? []).map((l) => l.order_id).filter((id): id is string => !!id))]
  const codes = new Map<string, string>()
  if (orderIds.length > 0) {
    const { data: orders } = await supabase.from('orders').select('id, code').in('id', orderIds)
    for (const o of orders ?? []) codes.set(o.id, o.code)
  }

  return {
    settlement: settlement as Settlement,
    rider: profile ?? null,
    lines: (lines ?? []).map((l) => ({
      ...l,
      kind: l.kind as LedgerKind,
      order_code: l.order_id ? (codes.get(l.order_id) ?? null) : null,
    })),
  }
}

export type SettlementDetail = NonNullable<Awaited<ReturnType<typeof getSettlement>>>
export type SettlementLine = SettlementDetail['lines'][number]

export async function getCodPositions(): Promise<CodPosition[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cod_positions')
  if (error) throw new Error(`positions unavailable: ${error.message}`)
  return (data ?? []) as unknown as CodPosition[]
}

export async function getShopPositions(from?: string, to?: string): Promise<ShopPosition[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cod_by_shop', {
    p_from: from ?? undefined,
    p_to: to ?? undefined,
  })
  if (error) throw new Error(`shop positions unavailable: ${error.message}`)
  return (data ?? []) as unknown as ShopPosition[]
}

export type LedgerLine = {
  id: number
  rider_id: string
  kind: LedgerKind
  amount: number
  memo: string | null
  order_id: string | null
  settlement_id: string | null
  created_at: string
}

export async function getLedger(filters: {
  riderId?: string
  kind?: LedgerKind
  settled?: 'open' | 'settled'
  limit?: number
}): Promise<LedgerLine[]> {
  const supabase = await createClient()
  let query = supabase
    .from('cod_ledger')
    .select('id, rider_id, kind, amount, memo, order_id, settlement_id, created_at')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 200)

  if (filters.riderId) query = query.eq('rider_id', filters.riderId)
  if (filters.kind) query = query.eq('kind', filters.kind)
  if (filters.settled === 'open') query = query.is('settlement_id', null)
  if (filters.settled === 'settled') query = query.not('settlement_id', 'is', null)

  const { data, error } = await query
  if (error) throw new Error(`ledger unavailable: ${error.message}`)
  return (data ?? []) as LedgerLine[]
}
