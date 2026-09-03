import { createClient } from '@/lib/supabase/server'
import { isoDaysAgo, nextDay, yangonToday } from '@/lib/admin/day'
import type { Order, OrderStatus } from '@/types/domain'

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
  counts: Record<
    'open' | 'pending' | 'inFlight' | 'delivered' | 'failed' | 'needsDecision' | 'total',
    number
  >
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
    { count: needsDecision },
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
    // Waiting on the shop specifically — see OrderFilters.needsDecision.
    ordersQuery().eq('status', 'failed').is('trip_id', null).is('resolution', null),
  ])

  return {
    shop: shop ?? null,
    counts: {
      open: (pending ?? 0) + (inFlight ?? 0),
      pending: pending ?? 0,
      inFlight: inFlight ?? 0,
      delivered: delivered ?? 0,
      failed: failed ?? 0,
      needsDecision: needsDecision ?? 0,
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

// ---------------------------------------------------------------------------
// One order, in full
// ---------------------------------------------------------------------------

export type ShopOrderDetail = {
  order: Order
  areaName: string | null
  route: { code: string; name: string; colour: string } | null
  events: Array<{ status: OrderStatus; at: string }>
  /** Name and plate of the rider carrying it. Never their phone — see the RPC. */
  rider: { fullName: string; vehiclePlate: string | null } | null
  /** Short-lived link to the delivery photo, or null when there isn't one. */
  proofUrl: string | null
  /** Failed DELIVERY attempts: picked_up -> failed. Excludes wasted trips (0018). */
  attempts: number
  /** How many delivery attempts happen automatically before the shop must decide. */
  maxAttempts: number
  /** Trips to the shop that came away empty: assigned -> failed. */
  uncollected: number
  maxCollectionAttempts: number
  /**
   * The parcel has failed, but only ever before pickup — so it is still sitting
   * on the shop's own shelf. "Return to shop" is meaningless for it, and
   * `resolve_failed_order` refuses that combination outright.
   */
  neverCollected: boolean
  /**
   * True when this parcel is waiting on the shop and nothing will happen to it
   * until they answer: it failed, it is off every run, and no decision is
   * recorded. That is a state the shop has to be shown, not one to infer.
   */
  awaitingDecision: boolean
}

/** How long a proof-photo link stays valid. Long enough to look at, not to share. */
const PROOF_URL_TTL_SECONDS = 300

/**
 * Everything the shop's order page shows.
 *
 * Three of these were stored but never rendered anywhere in the app before this:
 * the delivery photo, the receiver's name, and the reason a delivery failed. The
 * photo in particular is the shop's only evidence when a customer says the
 * parcel never arrived, and `proofs_read_parties` (migration 0004) has always
 * permitted the sending shop to read it — nothing ever asked.
 *
 * RLS returns nothing for another shop's order, so a miss is a 404 and needs no
 * ownership check here.
 */
export async function getShopOrderDetail(orderId: string): Promise<ShopOrderDetail | null> {
  const supabase = await createClient()

  const { data: order } = await supabase
    .from('orders')
    .select(
      '*, service_areas:dropoff_area_id (name), routes:route_id (code, name, colour)',
    )
    .eq('id', orderId)
    .maybeSingle()

  if (!order) return null

  const [
    { data: events },
    { data: riderCard },
    proofUrl,
    { data: attempts },
    { data: uncollected },
    { data: settings },
  ] = await Promise.all([
    supabase
      .from('order_status_events')
      .select('to_status, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true }),
    // A definer RPC because `profiles` and `rider_profiles` are not
    // shop-readable — without it the shop only ever sees a bare UUID.
    order.rider_id
      ? supabase.rpc('order_rider_card', { p_order_id: orderId })
      : Promise.resolve({ data: null }),
    signProof(supabase, order.proof_photo_path),
    supabase.rpc('order_attempt_count', { p_order_id: orderId }),
    supabase.rpc('order_uncollected_count', { p_order_id: orderId }),
    supabase
      .from('app_settings')
      .select('max_delivery_attempts, max_collection_attempts')
      .eq('id', true)
      .maybeSingle(),
  ])

  const card = riderCard as { full_name?: string; vehicle_plate?: string | null } | null
  const attemptCount = Number(attempts ?? 0)

  return {
    order: order as unknown as ShopOrderDetail['order'],
    areaName: (order.service_areas as unknown as { name: string } | null)?.name ?? null,
    route:
      (order.routes as unknown as { code: string; name: string; colour: string } | null) ?? null,
    events: (events ?? []).map((e) => ({ status: e.to_status as OrderStatus, at: e.created_at })),
    rider: card?.full_name
      ? { fullName: card.full_name, vehiclePlate: card.vehicle_plate ?? null }
      : null,
    proofUrl,
    attempts: attemptCount,
    maxAttempts: Number(settings?.max_delivery_attempts ?? 3),
    // Trips to the shop that came away empty (0018). A separate axis: a parcel
    // the shop never handed over must not burn a delivery attempt.
    uncollected: Number(uncollected ?? 0),
    maxCollectionAttempts: Number(settings?.max_collection_attempts ?? 3),
    /** Nothing to bring back — it is still on the shop's own shelf. */
    neverCollected: attemptCount === 0 && Number(uncollected ?? 0) > 0,
    // `status = 'failed'` alone is not enough: a parcel that failed while its run
    // is still out is dispatch's problem, not the shop's. It becomes the shop's
    // only once close_trip has detached it and declined to auto-retry.
    awaitingDecision:
      order.status === 'failed' && order.trip_id === null && order.resolution === null,
  }
}

async function signProof(
  supabase: Awaited<ReturnType<typeof createClient>>,
  path: string | null,
): Promise<string | null> {
  if (!path) return null
  // The bucket is private, so the object needs a signed link. A failure here is
  // never fatal: the rest of the page is still worth showing, and a missing
  // photo is reported as a missing photo rather than as a broken order.
  const { data } = await supabase.storage
    .from('delivery-proofs')
    .createSignedUrl(path, PROOF_URL_TTL_SECONDS)
  return data?.signedUrl ?? null
}

// ---------------------------------------------------------------------------
// Orders list: search, dates, pagination
// ---------------------------------------------------------------------------

export type OrderFilters = {
  status?: OrderStatus | null
  /**
   * Parcels waiting on the shop: failed, off every run, no decision recorded.
   * Its own filter rather than `status=failed` because a parcel that failed
   * while its run is still out is dispatch's problem, not the shop's.
   */
  needsDecision?: boolean
  /** Free text against code, customer name, phone or address. */
  q?: string | null
  /** Inclusive Yangon calendar dates, `YYYY-MM-DD`. */
  from?: string | null
  to?: string | null
  page?: number
  pageSize?: number
}

export type OrderPage = {
  rows: ShopOrderRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

export const DEFAULT_PAGE_SIZE = 25
/** Ceiling on one export, so a shop cannot ask for a file nobody can open. */
export const MAX_EXPORT_ROWS = 5000

/**
 * PostgREST `.or()` takes a comma-separated filter string, so a value containing
 * a comma or a parenthesis would be read as more filters. Stripping those
 * characters is safer than escaping them and costs nothing: they are not useful
 * search terms in a code, a name or a phone number.
 */
function sanitiseSearch(raw: string): string {
  return raw.trim().replace(/[,()*]/g, ' ').replace(/\s+/g, ' ').slice(0, 80)
}

/**
 * Shared by the shop's list and the office's. Exported rather than duplicated:
 * the date-boundary handling and the `.or()` sanitising are exactly the kind of
 * detail that drifts when copied.
 */
export function applyOrderFilters<T>(query: T, f: OrderFilters): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any
  if (f.needsDecision) {
    q = q.eq('status', 'failed').is('trip_id', null).is('resolution', null)
  } else if (f.status) {
    q = q.eq('status', f.status)
  }
  if (f.from) q = q.gte('created_at', `${f.from}T00:00:00+06:30`)
  // `to` is inclusive of the whole day, so the bound is the START of the next
  // one. Using `${to}T23:59:59` would silently drop orders in the final second.
  if (f.to) q = q.lt('created_at', `${nextDay(f.to)}T00:00:00+06:30`)

  const term = f.q ? sanitiseSearch(f.q) : ''
  if (term) {
    q = q.or(
      [
        `code.ilike.%${term}%`,
        `customer_name.ilike.%${term}%`,
        `customer_phone.ilike.%${term}%`,
        `dropoff_address.ilike.%${term}%`,
      ].join(','),
    )
  }
  return q as T
}

/**
 * One page of the shop's orders, with a real total.
 *
 * The list previously fetched a flat `.limit(100)` with no count, so a shop with
 * more than a hundred orders simply could not see the older ones and was given
 * no indication that anything was missing.
 */
export async function searchShopOrders(filters: OrderFilters): Promise<OrderPage> {
  const supabase = await createClient()
  const pageSize = Math.min(Math.max(filters.pageSize ?? DEFAULT_PAGE_SIZE, 1), 100)
  const page = Math.max(filters.page ?? 1, 1)
  const offset = (page - 1) * pageSize

  const query = applyOrderFilters(
    supabase
      .from('orders')
      .select(ORDER_LIST_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false }),
    filters,
  ).range(offset, offset + pageSize - 1)

  const { data, count, error } = await query
  if (error) throw new Error(`orders unavailable: ${error.message}`)

  const total = count ?? 0
  return {
    rows: (data ?? []) as unknown as ShopOrderRow[],
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  }
}

/** Every row matching the filters, for the CSV export. Capped, never paged. */
export async function exportShopOrders(filters: OrderFilters): Promise<ShopOrderRow[]> {
  const supabase = await createClient()
  const query = applyOrderFilters(
    supabase
      .from('orders')
      .select(ORDER_LIST_COLUMNS)
      .order('created_at', { ascending: false }),
    filters,
  ).limit(MAX_EXPORT_ROWS)

  const { data, error } = await query
  if (error) throw new Error(`export failed: ${error.message}`)
  return (data ?? []) as unknown as ShopOrderRow[]
}
