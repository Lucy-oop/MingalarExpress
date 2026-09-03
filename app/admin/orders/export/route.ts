import { NextResponse, type NextRequest } from 'next/server'
import { assertRole } from '@/lib/auth/guards'
import { exportAllOrders } from '@/lib/admin/order-queries'
import { MAX_EXPORT_ROWS } from '@/lib/orders/queries'
import { csvFilename, toCsv } from '@/lib/orders/csv'
import { formatDateTimeYangon } from '@/lib/utils'
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/types/domain'

/**
 * CSV of every order the office can see, honouring the list's filters.
 *
 * Same shape as the shop's export with the shop name and route added — the
 * office reconciles across shops, so a file without the shop on each row is
 * unusable to them.
 */

const STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]
const isStatus = (v: string | null): v is OrderStatus =>
  !!v && (STATUSES as string[]).includes(v)
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

const HEADERS = [
  'Code',
  'Created',
  'Shop',
  'Status',
  'Resolution',
  'Route',
  'Customer',
  'Phone',
  'Destination area',
  'Address',
  'Payment',
  'COD',
  'Delivery fee',
] as const

export async function GET(request: NextRequest) {
  try {
    await assertRole('dispatcher', 'super_admin')
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const p = request.nextUrl.searchParams
  const from = isDate(p.get('from')) ? p.get('from') : null
  const to = isDate(p.get('to')) ? p.get('to') : null

  let rows
  try {
    rows = await exportAllOrders({
      awaitingShop: p.get('view') === 'awaiting',
      returning: p.get('view') === 'returning',
      shopId: p.get('shop') || null,
      status: isStatus(p.get('status')) ? (p.get('status') as OrderStatus) : null,
      q: p.get('q')?.trim() || null,
      from,
      to,
    })
  } catch {
    return NextResponse.json({ error: 'export_failed' }, { status: 500 })
  }

  const csv = toCsv(
    HEADERS,
    rows.map((o) => [
      o.code,
      formatDateTimeYangon(o.created_at),
      o.shops?.name ?? '',
      ORDER_STATUS_LABEL[o.status],
      o.resolution ?? '',
      o.routes?.code ?? '',
      o.customer_name,
      o.customer_phone,
      o.dropoff_area?.name ?? '',
      o.dropoff_address,
      o.payment_method === 'cod' ? 'Cash on delivery' : 'Prepaid',
      // Raw integers: this is reconciled in a spreadsheet, where "13,500 Ks" is
      // not a number.
      o.payment_method === 'cod' ? o.cod_amount : 0,
      o.delivery_fee,
    ]),
  )

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename('mingalar-all-orders', from, to)}"`,
      'X-Export-Row-Limit': String(MAX_EXPORT_ROWS),
      'Cache-Control': 'no-store',
    },
  })
}
