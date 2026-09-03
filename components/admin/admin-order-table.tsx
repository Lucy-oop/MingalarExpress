import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/orders/status-badge'
import { formatAge, isStale, STALE_AFTER_HOURS } from '@/lib/admin/waiting'
import { formatDateTimeYangon, formatMmk, formatMyanmarPhone } from '@/lib/utils'
import type { AdminOrderRow } from '@/lib/admin/order-queries'

/**
 * The office's order list.
 *
 * Deliberately not the shop's table with a column bolted on. The office is
 * answering a different question — "where is this parcel and who has it" across
 * every shop — so it carries the shop, the route, and the thing the shop's table
 * has no concept of: whether a parcel is stuck waiting on somebody.
 *
 * In `worklist` mode — the "Waiting on a shop" view — it answers a third
 * question instead, and swaps two columns to do it. `Created` is useless there:
 * it is when the shop booked the parcel, which can be a week before it failed.
 * What a dispatcher working that queue needs is how long it has been ignored and
 * whether anyone has already rung the shop, or they call the same shop twice and
 * miss the one nobody has touched.
 */
export function AdminOrderTable({
  orders,
  worklist = false,
}: {
  orders: AdminOrderRow[]
  worklist?: boolean
}) {
  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm font-medium">No orders match</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {worklist
            ? 'Nothing is waiting on a shop right now.'
            : 'Try a wider date range, or clear the filters.'}
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className={`w-full text-sm ${worklist ? 'min-w-[66rem]' : 'min-w-[62rem]'}`}>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Code</th>
            <th className="px-3 py-2 font-medium">Shop</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">Destination</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">COD</th>
            <th className="px-3 py-2 text-right font-medium">Fee</th>
            {worklist ? (
              <>
                <th className="px-3 py-2 font-medium">Waiting</th>
                <th className="px-3 py-2 font-medium">Last contact</th>
              </>
            ) : (
              <th className="px-3 py-2 font-medium">Created</th>
            )}
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

            // Two days with nobody acting. The tint is the whole point of the
            // worklist: a queue where nothing looks urgent is a queue nobody
            // works. `closed_at` is the failure time — see lib/admin/waiting.
            const stale = awaitingShop && isStale(o.closed_at)

            return (
              <tr
                key={o.id}
                className={
                  stale ? 'bg-amber-100/70' : awaitingShop ? 'bg-amber-50/50' : undefined
                }
              >
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
                {worklist ? (
                  <>
                    <td
                      className="whitespace-nowrap px-3 py-2 text-xs"
                      title={
                        o.closed_at
                          ? `Failed ${formatDateTimeYangon(o.closed_at)}`
                          : 'No failure recorded'
                      }
                    >
                      <span
                        className={
                          stale ? 'font-semibold text-amber-900' : 'text-muted-foreground'
                        }
                      >
                        {formatAge(o.closed_at)}
                      </span>
                      {stale ? (
                        <span className="sr-only">
                          {' '}
                          — over {STALE_AFTER_HOURS / 24} days
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {o.noteCount > 0 ? (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <MessageSquare className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="tabular-nums">{o.noteCount}</span>
                          <span>· {formatAge(o.lastNoteAt)} ago</span>
                        </span>
                      ) : (
                        /* The important state. An untouched row is the one to
                           pick up, so it is the one that reads loudest. */
                        <Badge tone="red">Not chased</Badge>
                      )}
                    </td>
                  </>
                ) : (
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {formatDateTimeYangon(o.created_at)}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
