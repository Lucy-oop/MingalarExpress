'use client'

import * as React from 'react'
import {
  ChevronDown,
  Coins,
  Inbox,
  PackagePlus,
  Send,
  Truck,
  Undo2,
  UserRound,
  X,
} from 'lucide-react'
import { TripVolumeBanner, TripVolumePill } from '@/components/routes/trip-volume-banner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { StatusBadge } from '@/components/orders/status-badge'
import { cn, formatMmk } from '@/lib/utils'
import type { BoardRider, BoardTrip, BoardRoute } from '@/lib/routes/queries'
import type { OrderStatus } from '@/types/domain'

const TRIP_STATUS_TONE: Record<BoardTrip['status'], 'neutral' | 'gold' | 'blue' | 'green' | 'red'> =
  {
    planned: 'neutral',
    loading: 'gold',
    departed: 'blue',
    returned: 'green',
    closed: 'green',
    cancelled: 'red',
  }

const TRIP_STATUS_LABEL: Record<BoardTrip['status'], string> = {
  planned: 'Planned',
  loading: 'Loading',
  departed: 'On the road',
  returned: 'Back at hub',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

/**
 * One run on the planning board.
 *
 * The volume banner is mounted here rather than at the top of the page on
 * purpose: the 20-parcel rule is a property of a RUN, and a page-level banner
 * would leave a dispatcher hunting for which of four runs it meant.
 *
 * `TripVolumeBanner` renders nothing when the run is fine, so a full run is a
 * quiet card. That is deliberate — a warning that is always on screen stops
 * being read.
 */
export function TripCard({
  trip,
  route,
  riders,
  selectedCount,
  busy,
  onAssignRider,
  onLoadSelected,
  onUnload,
  onDepart,
  onReturn,
  onClose,
  onCancel,
}: {
  trip: BoardTrip
  route: BoardRoute
  riders: BoardRider[]
  /** How many unrouted parcels are ticked in the panel next door. */
  selectedCount: number
  busy: boolean
  onAssignRider: (riderId: string) => void
  onLoadSelected: (leg: 'delivery' | 'pickup') => void
  onUnload: (orderIds: string[]) => void
  onDepart: () => void
  onReturn: () => void
  onClose: () => void
  onCancel: () => void
}) {
  const [expanded, setExpanded] = React.useState(trip.status !== 'planned')

  const canLoad = trip.status === 'planned' || trip.status === 'loading'
  const canDepart = canLoad && trip.parcelCount + trip.pickupCount > 0
  const codHeadroom = route.maxCod - trip.codTotal
  const parcelHeadroom = route.maxParcels - trip.parcelCount

  return (
    <article className="overflow-hidden rounded-lg border bg-card">
      {/* ---- header ------------------------------------------------------ */}
      <header
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l-4 p-3"
        style={{ borderLeftColor: route.colour }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          <ChevronDown
            className={cn('size-4 shrink-0 transition-transform', expanded && 'rotate-180')}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{route.name}</span>
            {route.nameMm ? (
              <span className="block truncate text-xs text-muted-foreground">{route.nameMm}</span>
            ) : null}
          </span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <TripVolumePill check={trip.volume} />
          {trip.pickupCount > 0 ? (
            <Badge tone="neutral">
              <Inbox className="size-3" />
              {trip.pickupCount} pickup{trip.pickupCount === 1 ? '' : 's'}
            </Badge>
          ) : null}
          <Badge tone={trip.codTotal > 0 ? 'amber' : 'neutral'}>
            <Coins className="size-3" />
            {formatMmk(trip.codTotal)}
          </Badge>
          <Badge tone={TRIP_STATUS_TONE[trip.status]}>{TRIP_STATUS_LABEL[trip.status]}</Badge>
        </div>
      </header>

      {expanded ? (
        <div className="space-y-3 border-t p-3">
          <TripVolumeBanner check={trip.volume} />

          {trip.departOverrideReason ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
              <strong>Dispatched under minimum.</strong> {trip.departOverrideReason}
            </p>
          ) : null}

          {/* ---- rider ---------------------------------------------------- */}
          <div className="flex flex-wrap items-center gap-2">
            <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {canLoad ? (
              <Select
                value={trip.riderId ?? ''}
                onChange={(e) => e.target.value && onAssignRider(e.target.value)}
                disabled={busy}
                className="w-64"
                aria-label="Rider for this run"
              >
                <option value="">Choose a rider…</option>
                {riders.map((r) => (
                  <option
                    key={r.id}
                    value={r.id}
                    // A rider already out cannot take a second run
                    // (trips_rider_open_uk). Shown but not selectable, so the
                    // board explains the gap instead of hiding it.
                    disabled={r.onOpenTrip && r.id !== trip.riderId}
                  >
                    {r.name}
                    {r.vehiclePlate ? ` · ${r.vehiclePlate}` : ''}
                    {r.onOpenTrip && r.id !== trip.riderId ? ' — already out' : ''}
                    {!r.isOnline ? ' — offline' : ''}
                    {r.codInHand > 0 ? ` · holding ${r.codInHand.toLocaleString()} Ks` : ''}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="text-sm font-medium">{trip.riderName ?? 'No rider'}</span>
            )}
          </div>

          {/* ---- loading -------------------------------------------------- */}
          {canLoad ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2">
              <Button
                size="sm"
                disabled={busy || selectedCount === 0}
                onClick={() => onLoadSelected('delivery')}
              >
                <PackagePlus />
                Load {selectedCount > 0 ? selectedCount : ''} selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || selectedCount === 0}
                onClick={() => onLoadSelected('pickup')}
              >
                <Inbox />
                As pickups
              </Button>
              <span className="text-xs text-muted-foreground">
                room for {parcelHeadroom} more · {formatMmk(codHeadroom)} COD headroom
              </span>
            </div>
          ) : null}

          {/* ---- manifest ------------------------------------------------- */}
          {trip.parcels.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
              Nothing loaded yet. Tick parcels on the right, then load them onto this run.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {trip.parcels.map((p) => (
                <li key={p.id} className="flex items-center gap-2 p-2 text-xs">
                  <span className="w-6 shrink-0 text-center font-semibold tabular-nums text-muted-foreground">
                    {p.stopOrder ?? '–'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono font-semibold">{p.code}</span>
                      {p.leg === 'pickup' ? <Badge tone="neutral">Pickup</Badge> : null}
                      <StatusBadge status={p.status as OrderStatus} />
                    </span>
                    <span className="block truncate text-muted-foreground">
                      {p.areaName ? `${p.areaName} · ` : ''}
                      {p.dropoffAddress}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {p.paymentMethod === 'cod' ? formatMmk(p.codAmount) : 'Prepaid'}
                  </span>
                  {canLoad ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      disabled={busy}
                      onClick={() => onUnload([p.id])}
                      aria-label={`Unload ${p.code}`}
                    >
                      <Undo2 className="size-3.5" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {/* ---- actions -------------------------------------------------- */}
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {canLoad ? (
              <>
                <Button size="sm" disabled={busy || !canDepart} onClick={onDepart}>
                  <Send />
                  Depart trip
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
                  <X />
                  Cancel run
                </Button>
              </>
            ) : null}

            {trip.status === 'departed' ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={onReturn}>
                <Truck />
                Back at hub
              </Button>
            ) : null}

            {trip.status === 'departed' || trip.status === 'returned' ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>
                <Coins />
                Close &amp; pay
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  )
}
