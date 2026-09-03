import { createClient } from '@/lib/supabase/server'
import {
  applyOrderFilters,
  DEFAULT_PAGE_SIZE,
  MAX_EXPORT_ROWS,
  type OrderFilters,
} from '@/lib/orders/queries'
import type { OrderStatus } from '@/types/domain'

/**
 * Every order, across every shop — the office's view.
 *
 * The gap this fills: a delivered, cancelled or returned parcel appeared on NO
 * admin screen at all. The planning board deliberately drops finished work, and
 * `/track/[code]` is the public page that hides the phone, the address and the
 * rider. So the single most common support call — "the customer says
 * MGE-260901-000042 never arrived" — had no screen to answer it from.
 *
 * Scoping is `orders_all_dispatch` (`is_dispatch()`), so this is the same query
 * the shop list runs with the shop's own policy swapped out. The filter builder
 * is imported rather than copied: the inclusive date boundary and the `.or()`
 * sanitising are exactly the details that rot in a duplicate.
 */

const ADMIN_ORDER_COLUMNS = `
  id, code, status, customer_name, customer_phone, dropoff_address,
  cod_amount, delivery_fee, payment_method, created_at, closed_at,
  resolution, trip_id, rider_id,
  shops:shop_id (name),
  dropoff_area:dropoff_area_id (name),
  routes:route_id (code, colour)
` as const

export type AdminOrderRow = {
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
  /** Stamped by the status machine on entering `failed`; cleared on the way back
   *  to `pending`. For a parcel sitting at `failed` this is when it last failed. */
  closed_at: string | null
  resolution: string | null
  trip_id: string | null
  rider_id: string | null
  shops: { name: string } | null
  dropoff_area: { name: string } | null
  routes: { code: string; colour: string } | null
  /** Contact-log summary, filled in by `attachNoteStats`. */
  noteCount: number
  lastNoteAt: string | null
}

export type AdminOrderPage = {
  rows: AdminOrderRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

/** Extra axes the office needs that a shop does not. */
export type AdminOrderFilters = OrderFilters & {
  shopId?: string | null
  /** Parcels waiting on a shop to choose retry / return / cancel. */
  awaitingShop?: boolean
  /** Parcels a shop asked back that have not got there yet. */
  returning?: boolean
}

function applyAdminFilters<T>(query: T, f: AdminOrderFilters): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = applyOrderFilters(query, f) as any
  if (f.shopId) q = q.eq('shop_id', f.shopId)
  if (f.awaitingShop) {
    q = q.eq('status', 'failed').is('trip_id', null).is('resolution', null)
  }
  if (f.returning) {
    q = q.eq('resolution', 'return').not('status', 'in', '(cancelled,delivered,returned)')
  }
  return q as T
}

export async function searchAllOrders(filters: AdminOrderFilters): Promise<AdminOrderPage> {
  const supabase = await createClient()
  const pageSize = Math.min(Math.max(filters.pageSize ?? DEFAULT_PAGE_SIZE, 1), 100)
  const page = Math.max(filters.page ?? 1, 1)
  const offset = (page - 1) * pageSize

  // The awaiting view is a WORKLIST, not a search result, so it is ordered by
  // neglect: longest-waiting first. Everywhere else newest-first is right,
  // because the question there is "what just happened".
  //
  // Ordering on `closed_at` rather than on the event trail is what keeps this
  // one query — an age derived from order_status_events could be displayed but
  // not sorted or paginated on.
  const query = filters.awaitingShop
    ? supabase
        .from('orders')
        .select(ADMIN_ORDER_COLUMNS, { count: 'exact' })
        .order('closed_at', { ascending: true, nullsFirst: false })
    : supabase
        .from('orders')
        .select(ADMIN_ORDER_COLUMNS, { count: 'exact' })
        .order('created_at', { ascending: false })

  const { data, count, error } = await applyAdminFilters(query, filters).range(
    offset,
    offset + pageSize - 1,
  )

  if (error) throw new Error(`orders unavailable: ${error.message}`)

  const total = count ?? 0
  return {
    rows: await attachNoteStats(supabase, (data ?? []) as unknown as AdminOrderRow[]),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  }
}

/**
 * How many contact-log entries each parcel has, and when the last one was.
 *
 * A second query rather than an embedded aggregate: PostgREST's aggregate
 * support over an embedded table is version-dependent and silently returns
 * something else when it is not available, which is the worst failure mode for
 * a number a dispatcher is about to trust.
 *
 * Bounded by the page — at most 100 ids — and it answers the only question that
 * makes the worklist usable: has anyone already rung this shop?
 */
async function attachNoteStats(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: AdminOrderRow[],
): Promise<AdminOrderRow[]> {
  const withZero = rows.map((r) => ({ ...r, noteCount: 0, lastNoteAt: null as string | null }))
  if (withZero.length === 0) return withZero

  const { data, error } = await supabase
    .from('order_notes')
    .select('order_id, created_at')
    .in('order_id', withZero.map((r) => r.id))

  // A missing log is a missing column, not a missing page. `order_notes` is
  // dispatch-only, so a non-dispatch caller reaching here legitimately sees
  // nothing rather than an error.
  if (error) {
    console.error('[orders] could not summarise the contact log:', error.message)
    return withZero
  }

  const stats = new Map<string, { n: number; last: string }>()
  for (const row of data ?? []) {
    const prev = stats.get(row.order_id)
    if (!prev) stats.set(row.order_id, { n: 1, last: row.created_at })
    else {
      prev.n += 1
      if (row.created_at > prev.last) prev.last = row.created_at
    }
  }

  return withZero.map((r) => {
    const s = stats.get(r.id)
    return s ? { ...r, noteCount: s.n, lastNoteAt: s.last } : r
  })
}

export async function exportAllOrders(filters: AdminOrderFilters): Promise<AdminOrderRow[]> {
  const supabase = await createClient()
  const { data, error } = await applyAdminFilters(
    supabase
      .from('orders')
      .select(ADMIN_ORDER_COLUMNS)
      .order('created_at', { ascending: false }),
    filters,
  ).limit(MAX_EXPORT_ROWS)

  if (error) throw new Error(`export failed: ${error.message}`)
  // No note stats on the export: the CSV has no column for them and the extra
  // query would be per 5,000 rows rather than per page.
  return ((data ?? []) as unknown as AdminOrderRow[]).map((r) => ({
    ...r,
    noteCount: 0,
    lastNoteAt: null,
  }))
}

/** Shops, for the office's shop filter. Small enough to fetch whole. */
export async function getShopOptions(): Promise<Array<{ id: string; name: string }>> {
  const supabase = await createClient()
  const { data } = await supabase.from('shops').select('id, name').order('name')
  return data ?? []
}
