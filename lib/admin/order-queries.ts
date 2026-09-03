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
  cod_amount, delivery_fee, payment_method, created_at,
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
  resolution: string | null
  trip_id: string | null
  rider_id: string | null
  shops: { name: string } | null
  dropoff_area: { name: string } | null
  routes: { code: string; colour: string } | null
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

  const { data, count, error } = await applyAdminFilters(
    supabase
      .from('orders')
      .select(ADMIN_ORDER_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false }),
    filters,
  ).range(offset, offset + pageSize - 1)

  if (error) throw new Error(`orders unavailable: ${error.message}`)

  const total = count ?? 0
  return {
    rows: (data ?? []) as unknown as AdminOrderRow[],
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  }
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
  return (data ?? []) as unknown as AdminOrderRow[]
}

/** Shops, for the office's shop filter. Small enough to fetch whole. */
export async function getShopOptions(): Promise<Array<{ id: string; name: string }>> {
  const supabase = await createClient()
  const { data } = await supabase.from('shops').select('id, name').order('name')
  return data ?? []
}
