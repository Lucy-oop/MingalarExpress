import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/orders/status-badge'
import { formatDateTimeYangon, formatMmk, formatMyanmarPhone } from '@/lib/utils'
import type { AdminOrderRow } from '@/lib/admin/order-queries'

/**
 * The office's order list.
 *
 * Deliberately not the shop's table with a column bolted on. The office is
 * answering a different question — "where is this parcel and who has it" across
 * every shop — so it carries the shop, the route, and the thing the shop's table
 * has no concept of: whether a parcel is stuck waiting on somebody.
 */
export function AdminOrderTable({ orders }: { orders: AdminOrderRow[] }) {
  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm font-medium">No orders match</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try a wider date range, or clear the filters.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[62rem] text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Code</th>
            <th className="px-3 py-2 font-medium">Shop</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">Destination</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">COD</th>
            <th className="px-3 py-2 text-right font-medium">Fee</th>
            <th className="px-3 py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {orders.map((o) => {
            // The two states nobody is acting on. A parcel can sit in either for
            // days without anyone noticing, which is exactly what an office
            // needs a list to surface.
            const awaitingShop =
              o.status === 'failed' && o.trip_id === null && o.resolution === null
            const returning =
              o.resolution === 'return' &&
              !['cancelled', 'delivered', 'returned'].includes(o.status)

            return (
              <tr key={o.id} className={awaitingShop ? 'bg-destructive/5' : undefined}>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="font-mono text-xs font-semibold text-primary hover:underline"
                  >
                    {o.code}
                  </Link>
                </td>
                <td className="max-w-[10rem] truncate px-3 py-2">{o.shops?.name ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className="block">{o.customer_name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatMyanmarPhone(o.customer_phone)}
                  </span>
                </td>
                <td className="max-w-[15rem] px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    {o.routes ? (
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: o.routes.colour }}
                        title={o.routes.code}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span className="truncate">{o.dropoff_area?.name ?? o.dropoff_address}</span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="flex flex-wrap items-center gap-1">
                    <StatusBadge status={o.status} />
                    {awaitingShop ? <Badge tone="red">Waiting on shop</Badge> : null}
                    {returning ? <Badge tone="blue">Returning</Badge> : null}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {o.payment_method === 'cod' ? formatMmk(o.cod_amount) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMmk(o.delivery_fee)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {formatDateTimeYangon(o.created_at)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
