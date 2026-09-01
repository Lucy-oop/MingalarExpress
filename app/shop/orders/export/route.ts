import { NextResponse, type NextRequest } from 'next/server'
import { assertRole } from '@/lib/auth/guards'
import { exportShopOrders, MAX_EXPORT_ROWS } from '@/lib/orders/queries'
import { csvFilename, toCsv } from '@/lib/orders/csv'
import { formatDateTimeYangon } from '@/lib/utils'
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/types/domain'

/**
 * CSV of the shop's orders, honouring the same filters as the list.
 *
 * A route handler rather than a Server Action because the browser has to receive
 * it as a file: `Content-Disposition` is what makes it download with a sensible
 * name instead of rendering as text. RLS scopes the rows, so this cannot be used
 * to read another shop's orders even with a hand-written query string.
 */

const STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]
const isStatus = (v: string | null): v is OrderStatus =>
  !!v && (STATUSES as string[]).includes(v)
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

const HEADERS = [
  'Code',
  'Created',
  'Status',
  'Customer',
  'Phone',
  'Destination',
  'Payment',
  'COD collected',
  'Delivery fee',
] as const

export async function GET(request: NextRequest) {
  try {
    await assertRole('shop_owner')
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const p = request.nextUrl.searchParams
  const from = isDate(p.get('from')) ? p.get('from') : null
  const to = isDate(p.get('to')) ? p.get('to') : null

  let rows
  try {
    rows = await exportShopOrders({
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
      ORDER_STATUS_LABEL[o.status],
      o.customer_name,
      o.customer_phone,
      o.dropoff_address,
      o.payment_method === 'cod' ? 'Cash on delivery' : 'Prepaid',
      // Raw integers, not "13,500 Ks" — a shop reconciles this in a spreadsheet
      // and a formatted string is not a number there.
      o.payment_method === 'cod' ? o.cod_amount : 0,
      o.delivery_fee,
    ]),
  )

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename('mingalar-orders', from, to)}"`,
      // The cap is silent in the file itself, so say it in a header an operator
      // can find if a count ever looks short.
      'X-Export-Row-Limit': String(MAX_EXPORT_ROWS),
      'Cache-Control': 'no-store',
    },
  })
}
