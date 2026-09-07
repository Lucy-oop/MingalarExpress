'use client'

import * as React from 'react'
import { Coins, CornerUpLeft, MapPin, PackageOpen, PackagePlus, Search, Store, Warehouse } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { loadPlan, LOAD_BLOCKER_MESSAGE, type LoadTarget } from '@/lib/routes/load-gate'
import { cn, formatMmk } from '@/lib/utils'
import type { BoardRoute, UnroutedParcel } from '@/lib/routes/queries'

/** An unrouted parcel plus whether the shop has asked for it back. */
export type PanelParcel = UnroutedParcel & { isReturn: boolean; isHubHeld: boolean }

/** Everything the panel needs to name and measure the run it will load into. */
export type PanelTarget = LoadTarget & {
  /** Drives the panel's default route filter, so the pool follows the run. */
  routeId: string
  label: string
  colour: string
  riderName: string | null
}

/**
 * Parcels not yet on a run, and the one button that loads them.
 *
 * GROUPED BY AREA rather than by shop or by age because that is how a run is
 * built: everything for မြောက်ဥက္ကလာ goes on the same bike, and a dispatcher
 * wants to tick a whole township at once.
 *
 * THE LOAD BUTTON LIVES HERE NOW. It used to be three buttons on every trip
 * card, all reading the same global tick count, so twelve identical controls
 * competed to be the destination and the dispatcher's click was the only thing
 * distinguishing them. One button, next to the ticks it acts on, naming the run
 * it will fill.
 *
 * RETURNS ARE IN THE POOL. They were previously in a separate array that never
 * reached this component, so the board's own instruction — "tick them in the
 * parcel list and load them with As returns" — described something the data
 * model made impossible, and the return leg shipped in 0014 was unreachable.
 */
export function UnroutedPanel({
  parcels,
  routes,
  selected,
  target,
  busy,
  onToggle,
  onToggleMany,
  onClear,
  onLoad,
}: {
  parcels: PanelParcel[]
  routes: BoardRoute[]
  selected: Set<string>
  /** The run the board has targeted, or null when none is chosen. */
  target: PanelTarget | null
  busy: boolean
  onToggle: (id: string) => void
  onToggleMany: (ids: string[], select: boolean) => void
  onClear: () => void
  onLoad: (orderIds: string[], leg: 'delivery' | 'pickup' | 'return') => void
}) {
  const [query, setQuery] = React.useState('')
  const [routeFilter, setRouteFilter] = React.useState<string>('')

  const focusRouteId = target?.routeId ?? null
  // Follow the targeted run, otherwise the panel silently keeps showing another
  // route's parcels. The filter is stated on screen so the change is explained.
  React.useEffect(() => {
    setRouteFilter(focusRouteId ?? '')
  }, [focusRouteId])

  const routeById = React.useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes])

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return parcels.filter((p) => {
      // Returns travel to the shop, not to the customer's area, so a route
      // filter must never hide them — they belong on whichever run is going.
      if (p.isHubHeld) {
        // '__none' is its own case: a parcel whose area maps to no route cannot
        // be loaded anywhere and needs surfacing, not hiding.
        if (routeFilter === '__none') {
          if (p.suggestedRouteId !== null) return false
        } else if (routeFilter && p.suggestedRouteId !== routeFilter) {
          return false
        }
      }
      if (!q) return true
      return (
        p.code.toLowerCase().includes(q) ||
        p.customerName.toLowerCase().includes(q) ||
        p.dropoffAddress.toLowerCase().includes(q) ||
        (p.areaName ?? '').toLowerCase().includes(q)
      )
    })
  }, [parcels, query, routeFilter])

  /** Area groups, ordered by the stop sequence of the route they belong to. */
  const groups = React.useMemo(() => {
    const map = new Map<
      string,
      {
        key: string
        label: string
        routeId: string | null
        /** The shop's street address, on a collection group. */
        sub: string | null
        isReturn: boolean
        isHubHeld: boolean
        items: PanelParcel[]
      }
    >()
    for (const p of visible) {
      // Returns are one group of their own, whatever area they came from: they
      // are a different job, and mixing them into an area group would invite
      // the mixed selection that load_trip refuses.
      /*
        0028: the two halves group by different things, because they are
        different journeys. A COLLECTION run visits shops, so it groups by
        pickup address -- the ten parcels one shop booked are one stop, and
        their dropoff townships are irrelevant until they are at the hub. A
        DELIVERY run goes out to customers, so it groups by area as before.
      */
      const key = p.isReturn
        ? '__return'
        : p.isHubHeld
          ? (p.areaId ?? 'unmapped')
          : `shop:${p.pickupAddress.trim().toLowerCase()}`
      const entry = map.get(key) ?? {
        key,
        label: p.isReturn
          ? 'Back to the shop'
          : p.isHubHeld
            ? (p.areaName ?? 'No area set')
            : (p.shopName ?? (p.pickupAddress || 'Unknown shop')),
        sub: p.isHubHeld || p.isReturn ? null : p.pickupAddress,
        routeId: p.isReturn ? null : p.isHubHeld ? p.suggestedRouteId : null,
        isReturn: p.isReturn,
        isHubHeld: p.isHubHeld,
        items: [],
      }
      entry.items.push(p)
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => {
      if (a.isReturn !== b.isReturn) return a.isReturn ? -1 : 1
      // Then the hub shelf: it is stock already paid for in riding, and it
      // should go out before anything new is collected.
      if (a.isHubHeld !== b.isHubHeld) return a.isHubHeld ? -1 : 1
      const ra = a.routeId ? routeById.get(a.routeId)?.sortOrder ?? 999 : 999
      const rb = b.routeId ? routeById.get(b.routeId)?.sortOrder ?? 999 : 999
      return ra - rb || a.label.localeCompare(b.label)
    })
  }, [visible, routeById])

  const chosen = React.useMemo(
    () => parcels.filter((p) => selected.has(p.id)),
    [parcels, selected],
  )
  const plan = loadPlan(chosen, target)
  const hiddenTicks = selected.size - visible.filter((p) => selected.has(p.id)).length
  const hasReturns = chosen.some((p) => p.isReturn)
  const hasHeld = chosen.some((p) => p.isHubHeld)

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* ---- what this will load into ---------------------------------- */}
      <div className="rounded-md border bg-muted/40 p-2">
        {target ? (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Loading into
            </p>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: target.colour }}
                aria-hidden="true"
              />
              <span className="truncate">{target.label}</span>
              <span className="truncate font-normal text-muted-foreground">
                {target.riderName ?? 'no rider yet'}
              </span>
            </p>
            <p className="text-[11px] tabular-nums text-muted-foreground">
              room for {plan.parcelHeadroom} more · {formatMmk(plan.codHeadroom)} cash headroom
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Pick a run</span> on the left, then tick
            parcels to load into it.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Code, customer, address…"
            className="pl-8"
            aria-label="Search unrouted parcels"
          />
        </div>
        <Select
          value={routeFilter}
          onChange={(e) => setRouteFilter(e.target.value)}
          className="w-40 shrink-0"
          aria-label="Filter by route"
        >
          <option value="">All routes</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code.replace('ROUTE_', '')}
            </option>
          ))}
          <option value="__none">Unmapped</option>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {visible.length} of {parcels.length} waiting
          {/*
            Always the global count. This used to be conditioned on VISIBLE ticks
            while printing the global number, so changing the filter made the
            text vanish while the selection stayed live and loadable — the
            dispatcher saw "0 ticked" and a button offering to load ten.
          */}
          {selected.size > 0 ? ` · ${selected.size} ticked` : ''}
          {hiddenTicks > 0 ? ` (${hiddenTicks} hidden by the filter)` : ''}
        </span>
        {selected.size > 0 ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
            <PackageOpen className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">Nothing waiting</p>
            <p className="text-xs text-muted-foreground">
              {parcels.length > 0 ? 'No parcels match this filter.' : 'Every parcel is on a run.'}
            </p>
          </div>
        ) : (
          groups.map((group) => {
            const ids = group.items.map((p) => p.id)
            const allSelected = ids.every((id) => selected.has(id))
            const route = group.routeId ? routeById.get(group.routeId) : null
            const cod = group.items.reduce((sum, p) => sum + p.codAmount, 0)

            return (
              <section
                key={group.key}
                className={cn(
                  'rounded-lg border',
                  group.isReturn && 'border-blue-300',
                  group.isHubHeld && 'border-amber-300',
                )}
              >
                <header
                  className={cn(
                    'flex items-center gap-2 border-b p-2',
                    group.isReturn
                      ? 'bg-blue-50'
                      : group.isHubHeld
                        ? 'bg-amber-50'
                        : 'bg-muted/40',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => onToggleMany(ids, !allSelected)}
                    className="size-4 shrink-0 accent-brand-red"
                    aria-label={`Select all ${group.items.length} parcels for ${group.label}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      {group.isReturn ? (
                        <CornerUpLeft className="size-3 shrink-0" aria-hidden="true" />
                      ) : group.isHubHeld ? (
                        <MapPin className="size-3 shrink-0" aria-hidden="true" />
                      ) : (
                        <Store className="size-3 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate">{group.label}</span>
                    </span>
                    {group.sub ? (
                      <span className="block truncate text-[10px] font-normal text-muted-foreground">
                        {group.sub}
                      </span>
                    ) : null}
                  </span>
                  {group.isReturn ? (
                    <Badge tone="blue">Return</Badge>
                  ) : group.isHubHeld ? (
                    <Badge tone="amber">Out only</Badge>
                  ) : route ? (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                      style={{ backgroundColor: route.colour }}
                    >
                      {route.code.replace('ROUTE_', '')}
                    </span>
                  ) : (
                    <Badge tone="red">No route</Badge>
                  )}
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {group.items.length} · {formatMmk(cod)}
                  </span>
                </header>

                <ul className="divide-y">
                  {group.items.map((p) => {
                    const isSelected = selected.has(p.id)
                    return (
                      <li key={p.id}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-start gap-2 p-2 text-xs',
                            isSelected && 'bg-brand-gold/10',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onToggle(p.id)}
                            className="mt-0.5 size-4 shrink-0 accent-brand-red"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono font-semibold">{p.code}</span>
                              {p.status === 'failed' && !p.isReturn ? (
                                <Badge tone="red">Retry</Badge>
                              ) : null}
                              {p.isFragile ? <Badge tone="amber">Fragile</Badge> : null}
                            </span>
                            <span className="block truncate text-muted-foreground">
                              {p.customerName} · {p.dropoffAddress}
                            </span>
                          </span>
                          <span className="shrink-0 text-right tabular-nums">
                            {p.isReturn ? (
                              <span className="text-muted-foreground">No fee</span>
                            ) : p.paymentMethod === 'cod' ? (
                              <span className="flex items-center gap-1 font-medium">
                                <Coins className="size-3" aria-hidden="true" />
                                {formatMmk(p.codAmount)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Prepaid</span>
                            )}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })
        )}
      </div>

      {/* ---- the one load button --------------------------------------- */}
      <div className="space-y-1.5 border-t pt-2">
        {/*
          Deliver or collect, and only when it is a real choice. A return
          selection has its leg decided by the data — load_trip refuses any other
          — so offering the toggle there would be offering a choice the server
          does not have.
        */}
        {/*
          THERE IS NO TOGGLE ANY MORE. 0028 made the leg a property of the
          parcel, not a choice: still at its shop means collect, already at the
          hub means deliver, asked back means return. The old Deliver/Collect
          control offered four combinations of which three are now refused by
          load_trip, so it was a way to get an error rather than a decision.
          What replaces it is the group a parcel sits in, which is visible
          without ticking anything.
        */}

        <Button
          block
          disabled={busy || plan.blocker !== null}
          onClick={() => onLoad(chosen.map((p) => p.id), plan.leg)}
        >
          {plan.leg === 'return' ? <CornerUpLeft /> : <PackagePlus />}
          {plan.leg === 'return'
            ? `Send ${plan.count} back`
            : plan.count > 0
              ? `Load ${plan.count} into this run`
              : 'Load into this run'}
        </Button>

        {plan.blocker ? (
          <p className="text-center text-xs text-muted-foreground">
            {LOAD_BLOCKER_MESSAGE[plan.blocker]}
          </p>
        ) : null}
      </div>
    </div>
  )
}
