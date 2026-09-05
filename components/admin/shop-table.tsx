'use client'

import { Ban, CheckCircle2, Store } from 'lucide-react'
import type { ShopListRow } from '@/lib/admin/shop-queries'
import { SHOP_STATUS_LABEL } from '@/lib/validation/admin-shop'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn, formatDateTimeYangon, formatMmk, formatMyanmarPhone } from '@/lib/utils'

const STATUS_TONE = {
  active: 'green',
  suspended: 'red',
  pending: 'amber',
  // Blue, not amber: awaiting is work for the OFFICE, pending is work for the
  // shop. Two ambers would hide that difference at a glance, which is the whole
  // reason the states were split.
  awaiting: 'blue',
} as const

export function ShopTable({
  rows,
  onOpen,
  onStatus,
  onRegisterFor,
}: {
  rows: ShopListRow[]
  onOpen: (row: ShopListRow) => void
  onStatus: (row: ShopListRow, action: 'activate' | 'suspend' | 'approve' | 'reject') => void
  onRegisterFor: (row: ShopListRow) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <Store className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium">No shops match these filters</p>
        <p className="text-xs text-muted-foreground">
          Clear the search, or change the status filter.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[72rem] text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Shop</th>
            <th className="px-3 py-2 font-medium">Owner</th>
            <th className="px-3 py-2 font-medium">Address / ward</th>
            <th className="px-3 py-2 font-medium">Joined</th>
            <th className="px-3 py-2 text-right font-medium">Orders</th>
            <th className="px-3 py-2 text-right font-medium">COD balance</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">&nbsp;</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const pending = r.status === 'pending'
            return (
              <tr
                key={r.key}
                className={cn('hover:bg-muted/30', r.status === 'suspended' && 'bg-destructive/5')}
              >
                <td className="px-3 py-2">
                  {pending ? (
                    <span className="text-muted-foreground">— not registered —</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpen(r)}
                      className="text-left font-medium underline-offset-2 hover:underline"
                    >
                      {r.name}
                    </button>
                  )}
                  {r.phone ? (
                    <span className="block text-xs text-muted-foreground">
                      {formatMyanmarPhone(r.phone)}
                    </span>
                  ) : null}
                </td>

                <td className="px-3 py-2">
                  <span className={cn(!r.ownerActive && 'text-destructive')}>{r.ownerName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatMyanmarPhone(r.ownerPhone)}
                  </span>
                </td>

                <td className="max-w-64 px-3 py-2">
                  <span className="block truncate" title={r.pickupAddress ?? undefined}>
                    {r.pickupAddress ?? '—'}
                  </span>
                  <span className="block text-xs text-muted-foreground">{r.area ?? '—'}</span>
                </td>

                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {formatDateTimeYangon(r.joinedAt)}
                </td>

                <td className="px-3 py-2 text-right">
                  <span className="font-medium tabular-nums">{r.totalOrders}</span>
                  {r.totalOrders > 0 ? (
                    <span className="block text-[10px] uppercase text-muted-foreground">
                      {r.deliveredOrders} done · {r.inFlightOrders} live
                    </span>
                  ) : null}
                </td>

                <td className="px-3 py-2 text-right">
                  <span className="font-medium tabular-nums">{formatMmk(r.owedToShop)}</span>
                  {r.codInFlight > 0 ? (
                    <span className="block text-[10px] uppercase text-amber-700">
                      +{formatMmk(r.codInFlight)} in flight
                    </span>
                  ) : null}
                </td>

                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[r.status]}>{SHOP_STATUS_LABEL[r.status]}</Badge>
                  {r.status === 'suspended' && !r.ownerActive ? (
                    <span className="block text-[10px] uppercase text-muted-foreground">
                      login blocked
                    </span>
                  ) : null}
                </td>

                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1.5">
                    {pending ? (
                      <Button size="sm" onClick={() => onRegisterFor(r)}>
                        Confirm shop
                      </Button>
                    ) : r.status === 'awaiting' ? (
                      /* The shop described itself; this is the office's yes or
                         no. Confirm takes no typing at all -- that is the whole
                         point of the setup step. */
                      <>
                        <Button size="sm" variant="outline" onClick={() => onOpen(r)}>
                          Details
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onStatus(r, 'reject')}>
                          <Ban />
                          Reject
                        </Button>
                        <Button size="sm" onClick={() => onStatus(r, 'approve')}>
                          <CheckCircle2 />
                          Confirm
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" onClick={() => onOpen(r)}>
                          Details
                        </Button>
                        {r.status === 'active' ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => onStatus(r, 'suspend')}
                          >
                            <Ban />
                            Suspend
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => onStatus(r, 'activate')}>
                            <CheckCircle2 />
                            Activate
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
