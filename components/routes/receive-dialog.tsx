'use client'

import * as React from 'react'
import { CheckCheck, Warehouse } from 'lucide-react'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/orders/status-badge'
import { cn, formatMmk } from '@/lib/utils'
import { isReceivable } from '@/lib/routes/ways'
import type { BoardTrip } from '@/lib/routes/queries'
import type { OrderStatus } from '@/types/domain'

/**
 * The office checks a pickup run's parcels off the bike, one by one.
 *
 * NOTHING IS TICKED TO START WITH. The point of the list is that somebody
 * looked at each parcel; a list that opens fully ticked is confirmed with one
 * press and audits nothing. "Tick all" is there for the day everything is
 * obviously present, as a deliberate second press.
 *
 * What is confirmed goes into the hub, ready for a delivery way. What is left
 * unticked stays on the run as `picked_up` -- the rider says they have it and
 * the office has not seen it -- so it is still visible and still chaseable.
 * Parcels the rider never collected are listed, greyed, for the same reason.
 */
export function ReceiveDialog({
  trip,
  wayName,
  busy,
  onClose,
  onConfirm,
}: {
  trip: BoardTrip | null
  wayName: string
  busy: boolean
  onClose: () => void
  onConfirm: (orderIds: string[]) => void
}) {
  const [checked, setChecked] = React.useState<Set<string>>(new Set())

  // A fresh, empty checklist every time a run is opened.
  React.useEffect(() => {
    setChecked(new Set())
  }, [trip?.id])

  const pickups = (trip?.parcels ?? []).filter((p) => p.leg === 'pickup' && p.status !== 'cancelled')
  const receivable = pickups.filter(isReceivable)
  const allTicked = receivable.length > 0 && receivable.every((p) => checked.has(p.id))
  const missing = receivable.length - checked.size

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Overlay
      open={trip !== null}
      onClose={onClose}
      side="center"
      title="Received at office"
      description={`${wayName}${trip?.riderName ? ` · ${trip.riderName}` : ''}. Tick each parcel as it comes off the bike.`}
      className="max-w-lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {checked.size} of {receivable.length} ticked
            {checked.size > 0 && missing > 0 ? ` · ${missing} stay on the run` : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button disabled={busy || checked.size === 0} onClick={() => onConfirm([...checked])}>
              <Warehouse />
              Confirm received{checked.size > 0 ? ` · ${checked.size}` : ''}
            </Button>
          </div>
        </div>
      }
    >
      {pickups.length === 0 ? (
        <p className="text-sm text-muted-foreground">This run has no collections on it.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={receivable.length === 0}
              onClick={() =>
                setChecked(allTicked ? new Set() : new Set(receivable.map((p) => p.id)))
              }
            >
              <CheckCheck />
              {allTicked ? 'Untick all' : 'Tick all'}
            </Button>
          </div>
          <ul className="divide-y rounded-md border">
            {pickups.map((p) => {
              const can = isReceivable(p)
              return (
                <li key={p.id}>
                  <label
                    className={cn(
                      'flex items-start gap-3 p-3 text-sm',
                      can ? 'cursor-pointer hover:bg-muted/40' : 'opacity-60',
                      checked.has(p.id) && 'bg-emerald-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-brand-red"
                      checked={checked.has(p.id)}
                      disabled={!can || busy}
                      onChange={() => toggle(p.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-semibold">{p.code}</span>
                        {can ? null : <StatusBadge status={p.status as OrderStatus} />}
                        {can ? null : <Badge tone="neutral">Not collected</Badge>}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.customerName}
                        {p.areaName ? ` · to ${p.areaName}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums">
                      {p.paymentMethod === 'cod' ? formatMmk(p.codAmount) : 'Prepaid'}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Overlay>
  )
}
