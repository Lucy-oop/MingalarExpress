'use client'

import * as React from 'react'
import {
  ChevronDown,
  Coins,
  Inbox,
  Info,
  MapPin,
  Send,
  Truck,
  Undo2,
  Warehouse,
  X,
} from 'lucide-react'
import {
  isVolumeSilent,
  TripVolumeBanner,
  TripVolumePill,
} from '@/components/routes/trip-volume-banner'
import { RiderPicker } from '@/components/routes/rider-picker'
import { departBlocker, DEPART_BLOCKER_MESSAGE } from '@/lib/routes/depart-gate'
import { LOADABLE_STATUSES, summariseManifest } from '@/lib/routes/load-gate'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/orders/status-badge'
import { cn, formatMmk } from '@/lib/utils'
import type { BoardRider, BoardTrip } from '@/lib/routes/queries'
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
 * WHAT CHANGED, and why the card is much shorter than it was:
 *
 *  - LOADING LEFT. Three "Load N selected" buttons lived here, on every card,
 *    all enabled together and all reading the same global tick count — twelve
 *    identical buttons across four routes, with nothing saying which run a click
 *    would fill. There is now one button, in the parcel panel, against an
 *    explicit target. See lib/routes/load-gate.
 *  - THE RIDER CAME UP. Assignment was a native select buried inside the
 *    collapsed body; it is now chips in the header, visible without expanding.
 *  - THE MANIFEST IS A SUMMARY. Thirty parcels meant thirty rows, thirty
 *    identical status pills and thirty unload buttons — roughly 1,600px per
 *    card. The list is one click away and carries bulk unload.
 *  - EXPANSION FLIPPED. It was `trip.status !== 'planned'`, so the one card with
 *    a decision in it started closed while finished runs started open and filled
 *    the column with manifests nobody can act on.
 *
 * The volume banner stays mounted here rather than at the top of the page: the
 * rule is a property of a RUN, and a page-level banner leaves a dispatcher
 * hunting for which of four runs it meant.
 */
export function TripCard({
  trip,
  riders,
  targeted,
  busy,
  onTarget,
  onAssignRider,
  onUnload,
  onDepart,
  onReturn,
  onReceive,
  onClose,
  onCancel,
}: {
  trip: BoardTrip
  riders: BoardRider[]
  /** This is the run the parcel panel will load into. */
  targeted: boolean
  busy: boolean
  onTarget: () => void
  onAssignRider: (riderId: string) => void
  onUnload: (orderIds: string[]) => void
  onDepart: () => void
  onReturn: () => void
  onReceive: () => void
  onClose: () => void
  onCancel: () => void
}) {
  /*
    TWO DIFFERENT QUESTIONS, and conflating them would make the card lie.

    `canLoad` is "may this run still be EDITED at the hub" — rider swaps,
    unloading, Depart, Cancel. All of those are refused once the bike is gone:
    `assign_trip_rider` raises trip_rider_locked, `depart_trip` raises
    trip_not_departable.

    `canReceive` is "may parcels be added to it", which since 0039 includes a
    departed run. A rider on the road can be given more work; they cannot be
    swapped out from under it.
  */
  const canLoad = trip.status === 'planned' || trip.status === 'loading'
  const canReceive = LOADABLE_STATUSES.includes(trip.status)
  // Open where there is a decision to make, closed where there is not.
  const [expanded, setExpanded] = React.useState(canLoad)
  const [showParcels, setShowParcels] = React.useState(false)
  const [picked, setPicked] = React.useState<Set<string>>(new Set())

  // One reason, mirroring depart_trip's own order. See lib/routes/depart-gate.
  const blocker = departBlocker({
    status: trip.status,
    riderId: trip.riderId,
    parcelCount: trip.parcelCount,
    pickupCount: trip.pickupCount,
  })
  const summary = React.useMemo(() => summariseManifest(trip.parcels), [trip.parcels])
  const quiet = isVolumeSilent(trip.status, trip.parcelCount, trip.pickupCount)

  // Drop ticks for parcels that have left this run, so "Unload 4" cannot
  // silently become "unload 2" the way the board's own selection once did.
  const parcelIds = React.useMemo(() => new Set(trip.parcels.map((p) => p.id)), [trip.parcels])
  React.useEffect(() => {
    setPicked((prev) => {
      const next = new Set([...prev].filter((id) => parcelIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [parcelIds])

  return (
    <article
      className={cn(
        'overflow-hidden rounded-lg border bg-card transition-shadow',
        // The target is the one thing on the board that must be unmistakable:
        // it is where the next Load lands.
        targeted && 'ring-2 ring-primary ring-offset-1',
      )}
      onFocusCapture={canReceive ? onTarget : undefined}
    >
      {/*
        THE COLOURED EDGE IS GONE, and unlike the rider cards this one needed no
        replacement: the board's section heading directly above already names
        the route in its own colour — the same reasoning the title below is
        written on ("already names the route in its own colour; repeating it
        here was the card's widest element"). The stripe was a third statement
        of a fact already made twice.
      */}
      <header className="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/*
            THE FIRST CLICK SELECTS AND OPENS; only later ones fold.

            The board wraps every card in an onClick that targets it, so
            clicking the title used to do both at once — target the run and
            collapse the card, hiding the Depart button the operator was
            reaching for. Reaching for a control and having it disappear reads
            as the board fighting you, which is most of why this screen felt
            hostile.
          */}
          <button
            type="button"
            onClick={() => {
              if (!targeted) {
                onTarget()
                setExpanded(true)
              } else {
                setExpanded((v) => !v)
              }
            }}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={expanded}
          >
            <ChevronDown
              className={cn('size-4 shrink-0 transition-transform', expanded && 'rotate-180')}
              aria-hidden="true"
            />
            {/* The section heading directly above already names the route in its
                own colour; repeating it here was the card's widest element. */}
            <span className="truncate text-sm font-semibold">
              {summary.total > 0
                ? `${summary.total} parcel${summary.total === 1 ? '' : 's'}`
                : 'Empty run'}
            </span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {quiet ? null : <TripVolumePill check={trip.volume} />}
            {/*
              NAME THE RUN'S JOB, both halves of it. The card was identical for
              a collection run and a delivery run — same title, same border,
              same status words — and the only hint was a grey "N pickups"
              badge with no counterpart for deliveries. On a board whose whole
              purpose is separating the two ways, the runs said nothing.
            */}
            {trip.pickupCount > 0 ? (
              <Badge tone="neutral">
                <Inbox className="size-3" />
                {trip.pickupCount} to collect
              </Badge>
            ) : null}
            {summary.deliveries > 0 ? (
              <Badge tone="neutral">
                <Send className="size-3" />
                {summary.deliveries} to deliver
              </Badge>
            ) : null}
            <Badge tone={summary.cod > 0 ? 'amber' : 'neutral'}>
              <Coins className="size-3" />
              {formatMmk(summary.cod)}
            </Badge>
            <Badge tone={TRIP_STATUS_TONE[trip.status]}>{TRIP_STATUS_LABEL[trip.status]}</Badge>
          </div>
        </div>

        {/* The rider, in the header, never behind the expander. */}
        <RiderPicker
          riders={riders}
          riderId={trip.riderId}
          riderName={trip.riderName}
          editable={canLoad}
          busy={busy}
          loadedCount={trip.parcels.length}
          onAssign={onAssignRider}
        />
      </header>

      {expanded ? (
        <div className="space-y-3 border-t p-3">
          {quiet ? null : <TripVolumeBanner check={trip.volume} />}

          {trip.departOverrideReason ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
              <strong>Dispatched under minimum.</strong> {trip.departOverrideReason}
            </p>
          ) : null}

          {/* ---- manifest, as a shape ------------------------------------- */}
          {summary.total === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
              {targeted
                ? 'Tick parcels on the right, then load them onto this run.'
                : 'Nothing loaded yet.'}
            </p>
          ) : (
            <div className="rounded-md border">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2 text-xs">
                <span className="flex flex-wrap items-center gap-1.5">
                  <MapPin className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {summary.areas.slice(0, 4).map((a) => (
                    <span key={a.name} className="rounded bg-muted px-1.5 py-0.5">
                      {a.name} <span className="tabular-nums font-semibold">{a.count}</span>
                    </span>
                  ))}
                  {summary.areas.length > 4 ? (
                    <span className="text-muted-foreground">
                      +{summary.areas.length - 4} more
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => setShowParcels((v) => !v)}
                  className="ml-auto rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={showParcels}
                >
                  {showParcels ? 'Hide parcels' : `Show ${summary.total} parcels`}
                </button>
              </div>

              {showParcels ? (
                <>
                  {canLoad && picked.size > 0 ? (
                    <div className="flex items-center gap-2 border-t bg-muted/50 p-2">
                      {/* unload_trip has always taken an array; only the UI
                          insisted on one parcel per round trip. */}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          onUnload([...picked])
                          setPicked(new Set())
                        }}
                      >
                        <Undo2 />
                        Unload {picked.size}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                        Clear
                      </Button>
                    </div>
                  ) : null}

                  <ul className="divide-y border-t">
                    {trip.parcels.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 p-2 text-xs">
                        {canLoad ? (
                          <input
                            type="checkbox"
                            checked={picked.has(p.id)}
                            onChange={() =>
                              setPicked((prev) => {
                                const next = new Set(prev)
                                if (next.has(p.id)) next.delete(p.id)
                                else next.add(p.id)
                                return next
                              })
                            }
                            className="size-4 shrink-0 accent-brand-red"
                            aria-label={`Select ${p.code} to unload`}
                          />
                        ) : null}
                        <span className="w-6 shrink-0 text-center font-semibold tabular-nums text-muted-foreground">
                          {p.stopOrder ?? '–'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="font-mono font-semibold">{p.code}</span>
                            {p.leg === 'pickup' ? <Badge tone="neutral">Pickup</Badge> : null}
                            {p.leg === 'return' ? <Badge tone="blue">Return</Badge> : null}
                            {/* Only worth a pill once the run is moving; on a
                                planned run every parcel says the same thing. */}
                            {canLoad ? null : <StatusBadge status={p.status as OrderStatus} />}
                          </span>
                          <span className="block truncate text-muted-foreground">
                            {p.areaName ? `${p.areaName} · ` : ''}
                            {p.dropoffAddress}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {p.paymentMethod === 'cod' ? formatMmk(p.codAmount) : 'Prepaid'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          )}

          {/* ---- actions -------------------------------------------------- */}
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {canLoad ? (
              <>
                <Button size="sm" disabled={busy || blocker !== null} onClick={onDepart}>
                  <Send />
                  Depart trip
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
                  <X />
                  Cancel run
                </Button>
                {/*
                  Beside the button, as TEXT, and always visible rather than on
                  hover. A disabled control has `pointer-events-none`, so it can
                  carry no tooltip and take no focus -- a `title` here would
                  never fire, which is precisely how this became "the button
                  does nothing".
                */}
                {blocker ? (
                  <p className="flex items-center gap-1.5 self-center text-xs text-muted-foreground">
                    <Info className="size-3.5 shrink-0" aria-hidden="true" />
                    {DEPART_BLOCKER_MESSAGE[blocker]}
                  </p>
                ) : null}
              </>
            ) : null}

            {trip.status === 'departed' ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={onReturn}>
                <Truck />
                Back at hub
              </Button>
            ) : null}

            {/*
              RECEIVING IS NOT CLOSING, and this button exists because the two
              were the same press. A collected parcel keeps its trip_id until
              something detaches it, and every pool the office can sort from
              filters trip_id is null — so the afternoon's work was gated
              behind a button labelled after payroll. This is the inventory
              half on its own: the parcels hit the shelf, the run stays open,
              the rider is paid later and paid the same.

              Offered whenever the run is carrying collections, so a rider who
              drops a load and goes out again on the same run (possible since
              0039) can be received mid-day.
            */}
            {(trip.status === 'departed' || trip.status === 'returned') &&
            trip.pickupCount > 0 ? (
              <Button size="sm" disabled={busy} onClick={onReceive}>
                <Warehouse />
                Received at office · {trip.pickupCount}
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
