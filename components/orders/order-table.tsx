import Link from 'next/link'
import { PackageOpen } from 'lucide-react'
import { StatusBadge } from '@/components/orders/status-badge'
import { formatDateTimeYangon, formatMmk, formatMyanmarPhone } from '@/lib/utils'
import { formatDayHeader, groupByDay, yangonToday } from '@/lib/time/day'
import type { Order } from '@/types/domain'
import type { Locale } from '@/lib/i18n'

type Row = Pick<
  Order,
  | 'id'
  | 'code'
  | 'status'
  | 'customer_name'
  | 'customer_phone'
  | 'dropoff_address'
  | 'cod_amount'
  | 'delivery_fee'
  | 'payment_method'
  | 'created_at'
>

/**
 * GROUPED BY DAY, because a flat list of ninety rows ordered by `created_at`
 * gives a shop no purchase on it: `formatDateTimeYangon` renders "06 Sept,
 * 14:30" — no year — so scanning for "what did I send on Tuesday" means
 * reading every cell. A band per day answers it at a glance, and the header
 * carries the year the cells never had.
 *
 * ON A PAGINATED LIST A DAY CAN STRADDLE A PAGE BOUNDARY, so "6 Sept" heads the
 * bottom of one page and the top of the next. That is correct rather than a
 * flaw — each page stays self-describing — but it does rule out a per-day count
 * in the band without a second query, so there is not one.
 *
 * `grouped` is off for the dashboard's ten-row peek: three bands over ten rows
 * is noise, not structure.
 */
export function OrderTable({
  orders,
  grouped = true,
  locale = 'en',
}: {
  orders: Row[]
  grouped?: boolean
  locale?: Locale
}) {
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <PackageOpen className="size-8 text-muted-foreground" />
        <p className="font-medium">No orders yet</p>
        <p className="text-sm text-muted-foreground">
          Create your first delivery and it will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Code</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">Destination</th>
            <th className="px-3 py-2 text-right font-medium">COD</th>
            <th className="px-3 py-2 text-right font-medium">Fee</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Created</th>
          </tr>
        </thead>
        {(grouped
          ? groupByDay(orders, (o) => o.created_at)
          : [{ key: '', rows: orders }]
        ).map((group) => (
          <tbody key={group.key || 'all'} className="divide-y">
            {group.key ? (
              <tr>
                {/* Matching the <tfoot> totals band already used in
                    cod-explorer and settlement-detail, so the two full-width
                    rows in this app look like the same idea. */}
                <th
                  colSpan={7}
                  scope="colgroup"
                  className="bg-muted/50 px-3 py-1.5 text-left text-xs font-semibold"
                >
                  {formatDayHeader(group.key, yangonToday(), locale)}
                </th>
              </tr>
            ) : null}
            {group.rows.map((o) => (
            <tr key={o.id} className="hover:bg-muted/40">
              <td className="px-3 py-2">
                <Link
                  href={`/shop/orders/${o.id}`}
                  className="font-mono text-xs font-medium text-primary hover:underline"
                >
                  {o.code}
                </Link>
              </td>
              <td className="px-3 py-2">
                <div className="font-medium">{o.customer_name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatMyanmarPhone(o.customer_phone)}
                </div>
              </td>
              <td className="max-w-[240px] truncate px-3 py-2 text-muted-foreground">
                {o.dropoff_address}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {o.payment_method === 'cod' ? formatMmk(o.cod_amount) : '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMmk(o.delivery_fee)}</td>
              <td className="px-3 py-2">
                <StatusBadge status={o.status} />
              </td>
              <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                {formatDateTimeYangon(o.created_at)}
              </td>
            </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}
