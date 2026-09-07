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

  /*
    Grouped once, rendered twice. Both layouts need the same day bands, and
    computing them per presentation would let the two drift.
  */
  const groups = grouped
    ? groupByDay(orders, (o) => o.created_at)
    : [{ key: '', rows: orders }]
  const today = yangonToday()

  return (
    <>
      {/*
        PHONE: A LIST, NOT A TABLE. Seven columns cannot fit 360px — the table
        below carries `min-w-[720px]`, which is 2x overflow on the screen most
        shop owners actually hold. There is no CSS that makes it fit, so below
        `sm` the same rows render as one card each: code and status on the first
        line, then the customer, the destination and the money.

        Duplicated in the DOM rather than shuffled with CSS. Twenty-five rows
        twice is cheap, and one grid trying to be both a table and a stack ends
        up honest at neither width.
      */}
      <div className="space-y-3 sm:hidden">
        {groups.map((group) => (
          <section key={group.key || 'all'} className="space-y-2">
            {group.key ? (
              <h3 className="px-1 text-xs font-semibold text-muted-foreground">
                {formatDayHeader(group.key, today, locale)}
              </h3>
            ) : null}
            {group.rows.map((o) => (
              <Link
                key={o.id}
                href={`/shop/orders/${o.id}`}
                className="block rounded-lg border bg-card p-3 active:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-primary">{o.code}</span>
                  <StatusBadge status={o.status} />
                </div>
                <p className="mt-1.5 font-medium">{o.customer_name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatMyanmarPhone(o.customer_phone)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{o.dropoff_address}</p>
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-sm">
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">COD</dt>
                    <dd className="font-medium tabular-nums">
                      {o.payment_method === 'cod' ? formatMmk(o.cod_amount) : '—'}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Fee</dt>
                    <dd className="tabular-nums">{formatMmk(o.delivery_fee)}</dd>
                  </div>
                  <div className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {formatDateTimeYangon(o.created_at)}
                  </div>
                </dl>
              </Link>
            ))}
          </section>
        ))}
      </div>

    <div className="hidden overflow-x-auto rounded-lg border sm:block">
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
        {groups.map((group) => (
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
                  {formatDayHeader(group.key, today, locale)}
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
    </>
  )
}
