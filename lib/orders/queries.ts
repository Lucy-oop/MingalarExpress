import { createClient } from '@/lib/supabase/server'
import { yangonToday } from '@/lib/admin/day'
import type { OrderStatus } from '@/types/domain'

/**
 * Shop-side reads.
 *
 * RLS does all the scoping (`orders_read_shop`, `shops_owner_all`). No
 * `.eq('shop_id', ...)` filters appear here — adding one would imply the filter
 * is what protects the data. It is not.
 */

export const OPEN_STATUSES: OrderStatus[] = ['pending', 'assigned', 'picked_up']

export const ORDER_LIST_COLUMNS = `
  id, code, status, customer_name, customer_phone, dropoff_address,
  cod_amount, delivery_fee, payment_method, created_at
` as const

export type ShopOrderRow = {
  id: string
  code: string
  status: OrderStatus
  customer_name: string
  customer_phone: string
  dropoff_address: string
  cod_amount: number
  delivery_fee: number
  payment_method: 'cod' | 'prepaid'
  created_at: string
}

export type ShopDashboard = {
  shop: { id: string; name: string; pickup_address: string } | null
  counts: Record<'open' | 'pending' | 'inFlight' | 'delivered' | 'failed' | 'total', number>
  /** Cash the riders are still carrying for this shop, in MMK. */
  codInTransit: number
  recent: ShopOrderRow[]
}

/**
 * The shop dashboard, with REAL totals.
 *
 * Until 0010 these were computed in JS over the ten most recent orders, so any
 * shop with more than ten recent orders was shown an undercount of its own
 * money — "COD in transit" in particular. Counts now come from
 * `count: 'exact', head: true` probes, which return a number without shipping
 * any rows.
 *
 * `codInTransit` needs a sum rather than a count, so it fetches exactly one
 * column for the open COD orders and adds them up here. That is a handful of
 * kilobytes even for a busy shop, and it is exact.
 */
export async function getShopDashboard(): Promise<ShopDashboard> {
  const supabase = await createClient()

  // `head: true` returns the count in a Content-Range header and no rows at all,
  // so five buckets cost five tiny requests rather than five result sets.
  const ordersQuery = () => supabase.from('orders').select('*', { count: 'exact', head: true })

  const [
    { data: shop },
    { data: recent },
    { data: openCod },
    { count: total },
    { count: pending },
    { count: inFlight },
    { count: delivered },
    { count: failed },
  ] = await Promise.all([
    supabase.from('shops').select('id, name, pickup_address').limit(1).maybeSingle(),
    supabase
      .from('orders')
      .select(ORDER_LIST_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('orders')
      .select('cod_amount')
      .in('status', OPEN_STATUSES)
      .eq('payment_method', 'cod'),
    ordersQuery(),
    ordersQuery().eq('status', 'pending'),
    ordersQuery().in('status', ['assigned', 'picked_up']),
    ordersQuery().eq('status', 'delivered'),
    ordersQuery().eq('status', 'failed'),
  ])

  return {
    shop: shop ?? null,
    counts: {
      open: (pending ?? 0) + (inFlight ?? 0),
      pending: pending ?? 0,
      inFlight: inFlight ?? 0,
      delivered: delivered ?? 0,
      failed: failed ?? 0,
      total: total ?? 0,
    },
    codInTransit: (openCod ?? []).reduce((sum, o) => sum + Number(o.cod_amount ?? 0), 0),
    recent: (recent ?? []) as unknown as ShopOrderRow[],
  }
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export type ShopMoney = {
  from: string
  to: string
  delivered: number
  inTransit: number
  codCollected: number
  goodsValue: number
  platformFees: number
  owedToShop: number
}

/**
 * What the platform owes this shop over a date window.
 *
 * DERIVED, NOT A LEDGER. `cod_by_shop` computes these figures from `orders`
 * every time it is called; there is no shop-side double entry, so nothing here
 * can represent a partial payout, a dispute, or a payment actually made. That is
 * a deliberate limit recorded in ARCHITECTURE.md — if shop payouts ever need
 * reconciling, they need their own ledger and settlement tables rather than more
 * state bolted onto this function.
 *
 * Everything the money page renders comes through here, so replacing the source
 * later is a change to this function and nothing else.
 *
 * The RPC is `security invoker`, so RLS scopes it to the caller's own shop.
 */
export async function getShopMoney(from?: string, to?: string): Promise<ShopMoney> {
  const supabase = await createClient()
  const today = yangonToday()
  // Same 30-day default the RPC applies, resolved here so the page can show it.
  const start = from ?? isoDaysAgo(today, 30)
  const end = to ?? today

  const { data, error } = await supabase.rpc('cod_by_shop', { p_from: start, p_to: end })
  if (error) throw new Error(`money summary unavailable: ${error.message}`)

  // One row per shop the caller owns. A single-shop owner gets exactly one; the
  // rows are summed so a future multi-shop owner sees a coherent total rather
  // than silently only the first.
  const rows = (data ?? []) as unknown as Array<Record<string, number>>
  const sum = (key: string) => rows.reduce((n, r) => n + Number(r[key] ?? 0), 0)

  return {
    from: start,
    to: end,
    delivered: sum('delivered'),
    inTransit: sum('in_transit'),
    codCollected: sum('cod_collected'),
    goodsValue: sum('goods_value'),
    platformFees: sum('platform_fees'),
    owedToShop: sum('owed_to_shop'),
  }
}

/** `YYYY-MM-DD` minus n days, staying on the Yangon calendar. */
export function isoDaysAgo(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Route pricing
// ---------------------------------------------------------------------------

/** An area a shop can deliver to, with the route that prices it. */
export type AreaRoute = {
  areaId: string
  areaName: string
  areaNameMm: string | null
  areaKind: string
  routeId: string
  routeCode: string
  routeName: string
  colour: string
  /** What the shop pays for one parcel to this area, in MMK. */
  fee: number
}

const AREA_ROUTE_COLUMNS = `
  area_id,
  service_areas:area_id (name, name_mm, kind, is_active),
  routes:route_id (id, code, name, colour, per_parcel_fee, is_active)
` as const

type AreaRouteRow = {
  area_id: string
  service_areas: { name: string; name_mm: string | null; kind: string; is_active: boolean } | null
  routes: {
    id: string
    code: string
    name: string
    colour: string
    per_parcel_fee: number
    is_active: boolean
  } | null
}

function toAreaRoute(row: AreaRouteRow): AreaRoute | null {
  const a = row.service_areas
  const r = row.routes
  if (!a || !r || !a.is_active || !r.is_active) return null
  return {
    areaId: row.area_id,
    areaName: a.name,
    areaNameMm: a.name_mm,
    areaKind: a.kind,
    routeId: r.id,
    routeCode: r.code,
    routeName: r.name,
    colour: r.colour,
    fee: Number(r.per_parcel_fee),
  }
}

/**
 * Every deliverable area with its price, for the order form's area picker.
 *
 * Only PRIMARY mappings, because that is the route a parcel goes on by default
 * and therefore the one that prices it. A township can appear on several routes
 * (`route_areas` is many-to-many) but exactly one is primary — enforced by
 * `route_areas_primary_uk`.
 *
 * An area with no primary route is not returned at all: the shop cannot be
 * quoted for it, so offering it in the dropdown would only produce a rejected
 * submission.
 *
 * Both tables are `using (true)`, so this needs no elevated access.
 */
export async function getAreaRoutes(): Promise<AreaRoute[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('route_areas')
    .select(AREA_ROUTE_COLUMNS)
    .eq('is_primary', true)

  if (error) throw new Error(`delivery areas unavailable: ${error.message}`)

  return ((data ?? []) as unknown as AreaRouteRow[])
    .map(toAreaRoute)
    .filter((x): x is AreaRoute => x !== null)
    .sort((a, b) => a.routeCode.localeCompare(b.routeCode) || a.areaName.localeCompare(b.areaName))
}

/**
 * The route and fee for ONE area — the authoritative server-side price.
 *
 * `createOrder` calls this; the browser's copy from `getAreaRoutes` is a display
 * convenience and is never trusted, exactly as the distance quote never was.
 * Returns null when the area maps to no active route, which the caller must turn
 * into a visible field error rather than a silent zero.
 */
export async function resolveAreaRoute(areaId: string): Promise<AreaRoute | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('route_areas')
    .select(AREA_ROUTE_COLUMNS)
    .eq('area_id', areaId)
    .eq('is_primary', true)
    .maybeSingle()

  if (error || !data) return null
  return toAreaRoute(data as unknown as AreaRouteRow)
}
