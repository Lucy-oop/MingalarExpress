'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { TripCard } from '@/components/routes/trip-card'
import { UnroutedPanel, type PanelTarget } from '@/components/routes/unrouted-panel'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import {
  assignTripRider,
  cancelTrip,
  closeTrip,
  departTrip,
  loadTrip,
  planTrip,
  receiveTrip,
  returnTrip,
  sendToRider,
  unloadTrip,
  type TripResult,
} from '@/lib/routes/actions'
import type { BoardTrip, PlanningBoard } from '@/lib/routes/queries'
import { formatMmk } from '@/lib/utils'

type Feedback = { tone: 'success' | 'error' | 'info'; message: string }

/**
 * The route planning board — what replaced the offer-era dispatch board.
 *
 * Two columns, because that is the actual workflow: today's runs on the left,
 * the parcels not yet on a run on the right. A dispatcher ticks parcels on the
 * right and loads them into a run on the left, over and over, until the runs are
 * full enough to send.
 *
 * Runs are grouped by route and every active route gets a section even with no
 * run planned — an empty ROUTE_C section is information ("nobody has planned the
 * north run yet"), whereas its absence looks like the route does not exist.
 *
 * Server state comes from `getPlanningBoard` and is refreshed with
 * `router.refresh()` after every action. No optimistic local mutation: two
 * dispatchers work this board at once and the loser of a race has to see the
 * truth, not their own guess.
 */
export function RouteBoard({ board }: { board: PlanningBoard }) {
  const router = useRouter()
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [feedback, setFeedback] = React.useState<Feedback | null>(null)
  const [busyTripId, setBusyTripId] = React.useState<string | null>(null)
  const [refreshing, startTransition] = React.useTransition()

  /** The run the depart modal is asking about, once SQL says it is short. */

  /**
   * The run the next Load lands on.
   *
   * This used to be `focusRouteId`, a filter hint only: the panel followed it,
   * but the load TARGET was still whichever of a dozen identical "Load 10
   * selected" buttons the dispatcher happened to press. Now the target is
   * explicit, highlighted on the card, named in the panel, and there is one
   * button.
   */
  const [targetTripId, setTargetTripId] = React.useState<string | null>(null)

  /*
    Drop ticks for parcels that left the pool (another dispatcher loaded them).
    Without this, "Load 12 selected" silently becomes "load 9".

    ALL THREE POOLS, which it was not. Built from `board.unrouted` alone, it
    pruned every ticked return and — once 0027 added it — every ticked hub-held
    parcel, on the very next refresh. The board holds a realtime channel that
    refreshes on any order change anywhere, so a dispatcher ticking six returns
    could watch the selection empty itself while they reached for the button.
  */
  const poolIds = React.useMemo(
    () =>
      new Set(
        [...board.unrouted, ...board.returns, ...board.hubHeld].map((p) => p.id),
      ),
    [board.unrouted, board.returns, board.hubHeld],
  )
  React.useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => poolIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [poolIds])

  const refresh = React.useCallback(() => {
    startTransition(() => router.refresh())
  }, [router])

  /**
   * Live board.
   *
   * A shop creating a parcel has to appear in the unrouted pool without anyone
   * pressing Refresh — otherwise a dispatcher loads a run believing they have
   * seen everything waiting. `orders` and `trips` are both in the
   * `supabase_realtime` publication (0005 and 0009 respectively) and both are
   * RLS-filtered, so a dispatcher receives exactly the rows they may already
   * read.
   *
   * Coalesced through a short timer rather than refreshing per event: loading
   * twenty parcels onto a run emits twenty UPDATEs in one transaction, and
   * twenty `router.refresh()` calls would fight the action that caused them.
   */
  React.useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null

    const nudge = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        router.refresh()
      }, 400)
    }

    const channel = supabase
      .channel('dispatch-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, nudge)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, nudge)
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
    // `router` is stable in the app router; refresh() is deliberately called
    // directly rather than through `refresh` so the subscription is not torn
    // down and rebuilt whenever a transition starts.
  }, [router])

  const run = React.useCallback(
    async (tripId: string, fn: () => Promise<TripResult>, clearSelection = false) => {
      setBusyTripId(tripId)
      setFeedback(null)
      const result = await fn()
      setBusyTripId(null)

      if (result.ok) {
        if (clearSelection) setSelected(new Set())
        setFeedback({ tone: 'success', message: result.message })
      } else {
        setFeedback({ tone: 'error', message: result.message })
      }
      refresh()
      return result
    },
    [refresh],
  )

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleMany = (ids: string[], select: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (select) next.add(id)
        else next.delete(id)
      }
      return next
    })

  /*
    Depart, in ONE phase.

    This was two: call with no reason, catch `trip_below_minimum`, open a modal
    demanding ten characters, call again. 0039 made the reason optional — the
    volume banner still shows the shortfall, but the office is no longer asked
    to justify a short run to itself, and the audit row records it either way.
  */
  const handleDepart = (trip: BoardTrip) => run(trip.id, () => departTrip(trip.id))

  const tripsByRoute = React.useMemo(() => {
    const map = new Map<string, BoardTrip[]>()
    for (const t of board.trips) {
      const list = map.get(t.routeId) ?? []
      list.push(t)
      map.set(t.routeId, list)
    }
    return map
  }, [board.trips])

  const totalUnrouted = board.unrouted.length + board.returns.length + board.hubHeld.length
  const unmapped = board.unrouted.filter((p) => p.suggestedRouteId === null).length

  /**
   * One pool, deliveries and returns together.
   *
   * `board.returns` used to be shown only as an alert that told the dispatcher
   * to "tick them in the parcel list" — a list they never reached, because the
   * panel was passed `board.unrouted` alone. The return leg shipped in 0014 was
   * unreachable for that whole time. Tagging them here is what makes the
   * instruction true; `loadPlan` derives leg='return' from the tag.
   */
  const poolParcels = React.useMemo(
    () => [
      ...board.returns.map((p) => ({ ...p, isReturn: true, isHubHeld: false })),
      // Collected from a shop and on the hub shelf. Before 0027 these matched
      // no pool at all and simply were not on this board.
      ...board.hubHeld.map((p) => ({ ...p, isReturn: false, isHubHeld: true })),
      ...board.unrouted.map((p) => ({ ...p, isReturn: false, isHubHeld: false })),
    ],
    [board.returns, board.unrouted],
  )

  /** The targeted run, measured for the panel's ceilings and headroom. */
  const target = React.useMemo((): PanelTarget | null => {
    const trip = board.trips.find((t) => t.id === targetTripId)
    if (!trip) return null
    const route = board.routes.find((r) => r.id === trip.routeId)
    if (!route) return null
    const index = board.trips.filter((t) => t.routeId === trip.routeId).indexOf(trip) + 1
    return {
      tripId: trip.id,
      routeId: trip.routeId,
      status: trip.status,
      loaded: trip.parcels.map((p) => ({ leg: p.leg, codAmount: p.codAmount })),
      maxParcels: route.maxParcels,
      maxCod: route.maxCod,
      hasRider: trip.riderId !== null,
      label: `${route.code.replace('ROUTE_', 'Route ')} · run ${index}`,
      colour: route.colour,
      riderName: trip.riderName,
    }
  }, [board.trips, board.routes, targetTripId])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">Route planning</h1>
          <Badge tone="neutral">{board.serviceDate}</Badge>
          <Badge tone={totalUnrouted > 0 ? 'amber' : 'green'}>
            {totalUnrouted} unrouted
          </Badge>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
          Refresh
        </Button>
      </div>

      {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

      {/*
        Two pools dispatch cannot load but must not lose sight of. A board that
        only shows deliverable work hides parcels that have silently stalled —
        which is the failure mode 0011 exists to end, so hiding them here would
        just move it.
      */}
      {board.stalled.length > 0 ? (
        <Alert tone="info" title={`${board.stalled.length} waiting on a shop`}>
          <ParcelLine parcels={board.stalled} />
          <span className="mt-1 block text-xs">
            These reached the attempt limit. Nothing happens to
            them until the shop chooses retry, return or cancel — chase the shop, not the parcel.
          </span>
        </Alert>
      ) : null}

      {/*
        THE HUB SHELF. These were collected from a shop on an inbound run and
        carried to the hub; until 0027 they matched no pool and were simply not
        on this board, while sitting physically in the building. Given its own
        banner because the parcel is already paid for in riding and the only
        thing left is to send it out.
      */}
      {board.hubHeld.length > 0 ? (
        <Alert tone="warning" title={`${board.hubHeld.length} at the hub, waiting to go out`}>
          <ParcelLine parcels={board.hubHeld} />
          <span className="mt-1 block text-xs">
            Already collected and on the shelf. These are the only parcels a delivery run can
            carry — grouped by <strong>destination area</strong> in the list, since that is where
            they are going. Give the run a rider, tick them, and load.
          </span>
        </Alert>
      ) : null}

      {board.returns.length > 0 ? (
        <Alert
          tone="info"
          title={`${board.returns.length} to return to a shop`}
        >
          <ParcelLine parcels={board.returns} />
          <span className="mt-1 block text-xs">
            The shop asked for these back. They sit at the top of the parcel list under{' '}
            <strong>Back to the shop</strong> — pick a run, tick them, and load. They travel to the
            shop&rsquo;s own address and end at <em>Returned</em>, never at delivered, so no fee is
            charged.
          </span>
        </Alert>
      ) : null}

      {unmapped > 0 ? (
        <Alert tone="error" title="Parcels with no route">
          {unmapped} parcel{unmapped === 1 ? '' : 's'} sit in an area that is not mapped to any
          route, so no run can carry them. Map the area under Areas, or the parcels will keep
          ageing here unseen.
        </Alert>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        {/* ---- runs, grouped by route --------------------------------- */}
        <div className="space-y-4">
          {board.routes.map((route) => {
            const trips = tripsByRoute.get(route.id) ?? []
            return (
              <section key={route.id} className="space-y-2" aria-label={route.name}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: route.colour }}
                      aria-hidden="true"
                    />
                    {route.code.replace('ROUTE_', 'Route ')}
                    <span className="font-normal normal-case tracking-normal">
                      {formatMmk(route.perParcelFee)}/parcel
                    </span>
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyTripId !== null}
                    onClick={() => {
                      void run('new', () => planTrip(route.id, board.serviceDate)).then((r) => {
                        // planTrip returns the new trip's id, so the run it just
                        // created becomes the target — the dispatcher's next act
                        // is always to fill it.
                        if (r.ok && r.tripId) setTargetTripId(r.tripId)
                      })
                    }}
                  >
                    <Plus />
                    New run
                  </Button>
                </div>

                {trips.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                    No run planned on this route yet.
                  </p>
                ) : (
                  trips.map((trip) => (
                    <div key={trip.id} onClick={() => setTargetTripId(trip.id)}>
                      <TripCard
                        trip={trip}
                        route={route}
                        riders={board.riders}
                        targeted={trip.id === targetTripId}
                        busy={busyTripId === trip.id}
                        onTarget={() => setTargetTripId(trip.id)}
                        onAssignRider={(riderId) =>
                          void run(trip.id, () => assignTripRider(trip.id, riderId))
                        }
                        onUnload={(ids) => void run(trip.id, () => unloadTrip(trip.id, ids))}
                        onDepart={() => void handleDepart(trip)}
                        onReturn={() => void run(trip.id, () => returnTrip(trip.id))}
                        onReceive={() => void run(trip.id, () => receiveTrip(trip.id), true)}
                        onClose={() => {
                          if (
                            !window.confirm(
                              'Close this run and book the rider’s pay? The ledger is append-only, so this cannot be undone — a correction would be a new adjustment line.',
                            )
                          )
                            return
                          void run(trip.id, () => closeTrip(trip.id))
                        }}
                        onCancel={() => {
                          const reason = window.prompt('Why is this run being cancelled?')
                          if (reason === null) return
                          void run(trip.id, () => cancelTrip(trip.id, reason))
                        }}
                      />
                    </div>
                  ))
                )}
              </section>
            )
          })}
        </div>

        {/* ---- unrouted parcels -------------------------------------- */}
        <section
          className="max-h-[85vh] rounded-lg border bg-card p-3 lg:sticky lg:top-3"
          aria-label="Unrouted parcels"
        >
          <UnroutedPanel
            parcels={poolParcels}
            routes={board.routes}
            selected={selected}
            target={target}
            busy={busyTripId !== null}
            onToggle={toggle}
            onToggleMany={toggleMany}
            onClear={() => setSelected(new Set())}
            onLoad={(ids, leg) => {
              if (!target) return
              void run(target.tripId, () => loadTrip(target.tripId, ids, leg), true)
            }}
            riders={board.riders}
            /*
              No trip id to key `busy` on -- the run may not exist yet. `run`
              takes one to disable the card being acted on; here the whole
              panel is the thing acting, so a synthetic key keeps the spinner
              honest without pretending a card is busy.
            */
            onSend={(ids, riderId, routeId, leg) =>
              void run('send', () => sendToRider(ids, riderId, routeId, leg), true)
            }
          />
        </section>
      </div>

    </div>
  )
}

/** Codes and destinations, compactly — enough to act on without a whole table. */
function ParcelLine({ parcels }: { parcels: PlanningBoard['returns'] }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {parcels.slice(0, 6).map((p) => (
        <li key={p.id} className="flex flex-wrap gap-x-2">
          <span className="font-mono font-semibold">{p.code}</span>
          <span>{p.areaName ?? 'no area'}</span>
          <span className="text-muted-foreground">{p.customerName}</span>
        </li>
      ))}
      {parcels.length > 6 ? (
        <li className="text-muted-foreground">and {parcels.length - 6} more…</li>
      ) : null}
    </ul>
  )
}
