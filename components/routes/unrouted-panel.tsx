'use client'

import * as React from 'react'
import {
  Bike,
  Coins,
  CornerUpLeft,
  MapPin,
  PackageOpen,
  PackagePlus,
  Search,
  Send,
  Store,
  Warehouse,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  loadPlan,
  selectionLeg,
  LOAD_BLOCKER_MESSAGE,
  type LoadTarget,
} from '@/lib/routes/load-gate'
import { cn, formatMmk } from '@/lib/utils'
import { wayLabel } from '@/lib/routes/ways'
import type { BoardRider, BoardRoute, UnroutedParcel } from '@/lib/routes/queries'

/** An unrouted parcel plus whether the shop has asked for it back. */
export type PanelParcel = UnroutedParcel & { isReturn: boolean; isHubHeld: boolean }

/** Everything the panel needs to name and measure the run it will load into. */
export type PanelTarget = LoadTarget & {
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
  riders,
  onSend,
  onAssign,
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
  riders: BoardRider[]
  /** The one-action path: parcels straight to a rider, run handled for you. */
  onSend: (
    orderIds: string[],
    riderId: string,
    routeId: string,
    leg: 'delivery' | 'pickup' | 'return',
  ) => void
  /** The primary path (0049): put the ticked parcels on a way the office chose. */
  onAssign: (
    orderIds: string[],
    routeId: string,
    leg: 'delivery' | 'pickup' | 'return',
    riderId: string | undefined,
  ) => void
}) {
  const [query, setQuery] = React.useState('')
  /*
    A TOWNSHIP FILTER, where there used to be a route filter.

    The route filter keyed on the way each parcel's area maps to by default
    (route_areas.is_primary), and followed whichever run was targeted -- the
    board deciding the way for the office. The office now decides it by hand,
    so what they need to narrow by is where the parcel is going.
  */
  const [areaFilter, setAreaFilter] = React.useState<string>('')

  /*
    TWO TABS: PICKUP WAYS AND DELIVERY WAYS. The pool is the two halves of the
    day -- parcels still at their shop, waiting to be collected, and parcels in
    the hub waiting to go out -- and a run is loaded from one half at a time
    (load_trip refuses a mixed selection). Returns ride out to a shop, so they
    sit with the deliveries.

    Switching tab clears the ticks. A selection the operator can no longer see
    is how "Load 3" quietly loads something else, and a pickup tick carried
    into the delivery tab could only ever produce the mixed-legs refusal.
  */
  const [tab, setTab] = React.useState<'pickup' | 'delivery'>('pickup')
  const isDeliverySide = (p: PanelParcel) => p.isHubHeld || p.isReturn
  const pickupCount = parcels.filter((p) => !isDeliverySide(p)).length
  const deliveryCount = parcels.length - pickupCount
  const tabParcels = React.useMemo(
    () => parcels.filter((p) => (tab === 'delivery') === (p.isHubHeld || p.isReturn)),
    [parcels, tab],
  )
  const switchTab = (next: 'pickup' | 'delivery') => {
    if (next === tab) return
    setTab(next)
    setAreaFilter('')
    setAssignRider('')
    onClear()
  }

  const areaOptions = React.useMemo(() => {
    const names = new Map<string, number>()
    for (const p of tabParcels) {
      if (p.isReturn) continue
      const name = p.areaName ?? ''
      names.set(name, (names.get(name) ?? 0) + 1)
    }
    return [...names.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [tabParcels])

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return tabParcels.filter((p) => {
      // Returns travel to a shop, so a township filter never hides them.
      if (!p.isReturn && areaFilter !== '' && (p.areaName ?? '__none') !== areaFilter) {
        return false
      }
      if (!q) return true
      return (
        p.code.toLowerCase().includes(q) ||
        p.customerName.toLowerCase().includes(q) ||
        p.dropoffAddress.toLowerCase().includes(q) ||
        (p.areaName ?? '').toLowerCase().includes(q)
      )
    })
  }, [tabParcels, query, areaFilter])

  /** Returns, then the hub shelf by township, then the shops to collect from. */
  const groups = React.useMemo(() => {
    const map = new Map<
      string,
      {
        key: string
        label: string
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
      /*
        0049: THE DELIVERY HALF GROUPS BY TOWNSHIP, NOT BY A SUGGESTED WAY.
        0040 boxed the shelf by the way each area maps to by default, which
        was the board choosing the way. The office picks the way now, so the
        box is the thing they decide about: everything going to one township.
      */
      const key = p.isReturn
        ? '__return'
        : p.isHubHeld
          ? `area:${p.areaId ?? 'none'}`
          : `shop:${p.pickupAddress.trim().toLowerCase()}`
      const entry = map.get(key) ?? {
        key,
        label: p.isReturn
          ? 'Back to the shop'
          : p.isHubHeld
            ? (p.areaName ?? 'No township set')
            : (p.shopName ?? (p.pickupAddress || 'Unknown shop')),
        sub: p.isHubHeld || p.isReturn ? null : p.pickupAddress,
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
      return a.label.localeCompare(b.label)
    })
  }, [visible])

  /*
    THE THREE HALVES, counted once so each heading can carry its own total.
    Order is fixed by the comparator above: returns, then the shelf, then the
    shops. That was already the order; what was missing was anyone saying so.
  */
  const kindOf = (g: { isReturn: boolean; isHubHeld: boolean }) =>
    g.isReturn ? 'return' : g.isHubHeld ? 'deliver' : ('collect' as const)

  const kindTotals = React.useMemo(() => {
    const t = { deliver: 0, return: 0, collect: 0 }
    for (const g of groups) t[kindOf(g) as keyof typeof t] += g.items.length
    return t
  }, [groups])

  const KIND_HEADING: Record<string, string> = {
    deliver: 'IN HUB · READY TO DELIVER',
    return: 'BACK TO A SHOP',
    collect: 'TO COLLECT',
  }

  const chosen = React.useMemo(
    () => parcels.filter((p) => selected.has(p.id)),
    [parcels, selected],
  )
  const plan = loadPlan(chosen, target)

  /*
    THE SEND PATH. The leg is still derived -- `selectionLeg` is the same
    derivation loadPlan uses, and a second opinion would eventually disagree
    with load_trip.

    THE WAY IS NOT. It used to default to the majority suggested route across
    the ticked parcels; the office now names it every time (0049). It is only
    consulted for a NEW run: a rider already out keeps their own run's way,
    which is why it is not demanded for them.
  */
  const send = selectionLeg(chosen)
  const [sendRider, setSendRider] = React.useState<string>('')
  const [sendRoute, setSendRoute] = React.useState<string>('')
  const routeForSend = sendRoute
  const riderOut = riders.find((r) => r.id === sendRider)?.onOpenTrip ?? false

  /*
    A rider already out is NOT barred here, which is the whole point of the
    flow: `sendToRider` finds their open run and tops it up rather than
    refusing. The chip says where they are so the choice is informed.
  */
  const sendBlocker: string | null = (() => {
    if (chosen.length === 0) return 'Tick some parcels first.'
    if (send.mixed) return LOAD_BLOCKER_MESSAGE.mixed_legs
    if (riders.length === 0) return null
    if (!sendRider) return 'Choose a rider.'
    if (!riderOut && !routeForSend) return 'Choose a way for the new run.'
    return null
  })()
  const hiddenTicks = selected.size - visible.filter((p) => selected.has(p.id)).length
  const hasReturns = chosen.some((p) => p.isReturn)
  const hasHeld = chosen.some((p) => p.isHubHeld)

  /*
    ASSIGN TO A WAY -- the office's decision, made here, and the parcels then
    show under that way on the left. The rider picker is on BOTH tabs:

      pickups     optional. Chosen, the parcels go on that rider's run on the
                  way (or a new one with them); left blank, they wait on a
                  rider-less run and the rider is given on the left later.
      deliveries  required only when the way has no run with a rider yet,
                  because a hub-held parcel is assigned to the run's rider
                  (see `assignToWay`); the server works that out and says.
  */
  const [assignWay, setAssignWay] = React.useState('')
  const [assignRider, setAssignRider] = React.useState('')
  const assignBlocker: string | null =
    chosen.length === 0
      ? 'Tick parcels, then choose their way.'
      : send.mixed
        ? LOAD_BLOCKER_MESSAGE.mixed_legs
        : !assignWay
          ? 'Choose a way.'
          : null

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* ---- what this will load into ---------------------------------- */}
      <div className={cn('rounded-md border bg-muted/40 p-2', !target && 'hidden')}>
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

      <div role="tablist" aria-label="Parcels waiting" className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1">
        {(
          [
            ['pickup', 'Pickup ways', 'At shops, to collect', pickupCount],
            ['delivery', 'Delivery ways', 'In hub · ready to deliver', deliveryCount],
          ] as const
        ).map(([key, label, sub, n]) => {
          const on = tab === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => switchTab(key)}
              className={cn(
                'flex flex-col items-start rounded-md px-2.5 py-1.5 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                on ? 'bg-card shadow-sm' : 'text-muted-foreground hover:bg-card/60',
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {key === 'pickup' ? (
                  <Store className="size-3.5" aria-hidden="true" />
                ) : (
                  <Warehouse className="size-3.5" aria-hidden="true" />
                )}
                {label}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] tabular-nums',
                    on ? 'bg-primary text-primary-foreground' : 'bg-muted',
                  )}
                >
                  {n}
                </span>
              </span>
              <span className="text-[10px] text-muted-foreground">{sub}</span>
            </button>
          )
        })}
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
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          className="w-40 shrink-0"
          aria-label="Filter by township"
        >
          <option value="">All townships</option>
          {areaOptions.map(([name, n]) => (
            <option key={name || '__none'} value={name || '__none'}>
              {name || 'No township'} ({n})
            </option>
          ))}
        </Select>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {visible.length} of {tabParcels.length} waiting
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

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <PackageOpen className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">Nothing waiting</p>
            <p className="text-xs text-muted-foreground">
              {tabParcels.length > 0
                ? 'No parcels match this filter.'
                : tab === 'pickup'
                  ? 'Nothing waiting at a shop to be collected.'
                  : 'Nothing in the hub waiting to go out.'}
            </p>
          </div>
        ) : (
          /*
            A TABLE, one per tab: the pickup ways table lists parcels still at
            their shops, grouped by shop; the delivery ways table lists parcels
            in the hub, grouped by township, with returns first. A group's
            heading row ticks the whole group.
          */
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-card text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b">
                <th className="w-8 p-2" aria-label="Select" />
                <th className="p-2 font-medium">Parcel</th>
                <th className="p-2 font-medium">{tab === 'pickup' ? 'Customer' : 'Deliver to'}</th>
                <th className="p-2 text-right font-medium">Cash</th>
              </tr>
            </thead>
            {groups.map((group, i) => {
              const ids = group.items.map((p) => p.id)
              const allSelected = ids.every((id) => selected.has(id))
              /*
                LEG-AWARE, because a return's cod_amount is money nobody will
                collect — the rows beneath already say "No fee" and the header
                was contradicting them.
              */
              const cod = group.isReturn
                ? 0
                : group.items.reduce((sum, p) => sum + p.codAmount, 0)
              const kind = kindOf(group)
              const first = i === 0 || kindOf(groups[i - 1]!) !== kind
              return (
                <tbody key={group.key}>
                  {first && tab === 'delivery' ? (
                    <tr>
                      <td colSpan={4} className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {KIND_HEADING[kind]} · <span className="tabular-nums">{kindTotals[kind as keyof typeof kindTotals]}</span>
                      </td>
                    </tr>
                  ) : null}
                  <tr
                    className={cn(
                      'border-y',
                      group.isReturn ? 'bg-blue-50' : group.isHubHeld ? 'bg-amber-50' : 'bg-muted/40',
                    )}
                  >
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => onToggleMany(ids, !allSelected)}
                        className="size-4 accent-brand-red"
                        aria-label={`Select all ${group.items.length} parcels for ${group.label}`}
                      />
                    </td>
                    <td colSpan={2} className="p-2">
                      <span className="flex items-center gap-1.5 font-semibold">
                        {group.isReturn ? (
                          <CornerUpLeft className="size-3 shrink-0" aria-hidden="true" />
                        ) : group.isHubHeld ? (
                          <MapPin className="size-3 shrink-0" aria-hidden="true" />
                        ) : (
                          <Store className="size-3 shrink-0" aria-hidden="true" />
                        )}
                        <span className="truncate">{group.label}</span>
                        {group.isReturn ? <Badge tone="blue">Return</Badge> : null}
                      </span>
                      {group.sub ? (
                        <span className="block truncate text-[10px] text-muted-foreground">{group.sub}</span>
                      ) : null}
                    </td>
                    <td className="p-2 text-right text-[10px] tabular-nums text-muted-foreground">
                      {group.items.length} · {formatMmk(cod)}
                    </td>
                  </tr>
                  {group.items.map((p) => {
                    const isSelected = selected.has(p.id)
                    return (
                      <tr
                        key={p.id}
                        className={cn('cursor-pointer border-b last:border-b-0', isSelected && 'bg-brand-gold/10')}
                        onClick={() => onToggle(p.id)}
                      >
                        <td className="p-2 align-top">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onToggle(p.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="size-4 accent-brand-red"
                            aria-label={`Select ${p.code}`}
                          />
                        </td>
                        <td className="p-2 align-top">
                          <span className="font-mono font-semibold">{p.code}</span>
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            {p.status === 'failed' && !p.isReturn ? <Badge tone="red">Retry</Badge> : null}
                            {p.isFragile ? <Badge tone="amber">Fragile</Badge> : null}
                          </span>
                        </td>
                        <td className="max-w-0 p-2 align-top">
                          <span className="block truncate">{p.customerName}</span>
                          <span className="block truncate text-muted-foreground">
                            {tab === 'pickup' && p.areaName ? `${p.areaName} · ` : ''}
                            {p.dropoffAddress}
                          </span>
                        </td>
                        <td className="p-2 text-right align-top tabular-nums">
                          {p.isReturn ? (
                            <span className="text-muted-foreground">No fee</span>
                          ) : p.paymentMethod === 'cod' ? (
                            <span className="inline-flex items-center gap-1 font-medium">
                              <Coins className="size-3" aria-hidden="true" />
                              {formatMmk(p.codAmount)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Prepaid</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              )
            })}
          </table>
        )}
      </div>

      {/* ---- ASSIGN TO A WAY: the primary action (0049) ------------------ */}
      <div className="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Assign to a way
        </p>
        <div className="flex flex-wrap gap-2">
          <Select
            value={assignWay}
            onChange={(e) => setAssignWay(e.target.value)}
            disabled={busy}
            aria-label="Way"
            className="min-w-0 flex-1 text-xs"
          >
            <option value="">Choose a way…</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {wayLabel(r.code)} · {r.name.replace(/^(Way \d+|Local Way)\s*—\s*/, '')}
              </option>
            ))}
          </Select>
          {riders.length > 0 ? (
            <Select
              value={assignRider}
              onChange={(e) => setAssignRider(e.target.value)}
              disabled={busy}
              aria-label="Rider for the way"
              className="min-w-0 flex-1 text-xs"
            >
              <option value="">
                {tab === 'pickup' ? 'Rider (optional)' : 'Rider (if the way has none yet)'}
              </option>
              {riders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.onOpenTrip ? ' · on a run' : ''}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
        <Button
          block
          disabled={busy || assignBlocker !== null}
          onClick={() =>
            onAssign(
              chosen.map((p) => p.id),
              assignWay,
              send.leg,
              assignRider || undefined,
            )
          }
        >
          <PackagePlus />
          {chosen.length > 0
            ? `Put ${chosen.length} on ${assignWay ? wayLabel(routes.find((r) => r.id === assignWay)?.code ?? '') : 'a way'}`
            : 'Put on a way'}
        </Button>
        {assignBlocker ? (
          <p className="text-center text-xs text-muted-foreground">{assignBlocker}</p>
        ) : null}
      </div>

      {/*
        THE OTHER TWO PATHS, kept but folded away. Sending straight to a rider
        (assign and depart in one) and loading into the run picked on the left
        both still work exactly as before; putting parcels on a way is simply
        the one the office asked to lead with.
      */}
      <details className="rounded-md border p-2 [&[open]>summary]:mb-2">
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Other ways to assign
        </summary>
      {/* ---- the one load button --------------------------------------- */}
      {/* ---- SEND: the one-action path ---------------------------------- */}
      {/*
        THIS IS THE PRIMARY WAY TO ASSIGN NOW, and it sits above the Load
        button on purpose. Loading into a targeted run is still there for the
        cases that need it -- mixed batches, topping up a specific run, unload
        -- but the common case is "give these to this rider", and that used to
        cost four clicks in a fixed order with two blockers that only appeared
        after the wrong one.

        No run is chosen here, and none has to be: `sendToRider` finds the
        rider's open run or makes one. A rider already on the road is a
        TOP-UP, which is exactly why they are not barred from this list.
      */}
      <div className="space-y-1.5 border-t pt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Send straight to a rider
        </p>

        {riders.length === 0 ? (
          /*
            The empty state that was missing. With no riders the picker
            rendered an empty row and said nothing, on a board whose whole
            purpose is handing work to riders -- so the operator was left
            looking for a control that could not exist yet.
          */
          <p className="rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">No riders yet.</span> Add one on the{' '}
            <a href="/admin/super/riders" className="text-primary underline">
              Riders
            </a>{' '}
            page, then come back and send this parcel out.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {riders.map((r) => {
                const picked = r.id === sendRider
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setSendRider(picked ? '' : r.id)}
                    aria-pressed={picked}
                    className={cn(
                      'flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
                      picked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-card hover:bg-muted',
                      busy && 'opacity-50',
                    )}
                  >
                    <Bike className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{r.name}</span>
                    {/* Where they are, not whether they may be picked. */}
                    {r.onOpenTrip ? (
                      <span
                        className={cn(
                          'shrink-0 text-[10px]',
                          picked ? 'text-primary-foreground/80' : 'text-muted-foreground',
                        )}
                      >
                        on a run
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>

            {/* Chosen by hand, never guessed from the townships. Only consulted
                for a NEW run — a rider already out keeps their own run's way. */}
            {riderOut ? (
              <p className="text-xs text-muted-foreground">
                Tops up the way this rider is already on.
              </p>
            ) : (
              <Select
                value={routeForSend}
                onChange={(e) => setSendRoute(e.target.value)}
                disabled={busy}
                aria-label="Way for a new run"
                className="text-xs"
              >
                <option value="">Choose a way…</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {wayLabel(r.code)} · {r.name.replace(/^(Way \d+|Local Way)\s*—\s*/, '')}
                  </option>
                ))}
              </Select>
            )}

            <Button
              block
              disabled={busy || sendBlocker !== null}
              onClick={() => onSend(chosen.map((p) => p.id), sendRider, routeForSend, send.leg)}
            >
              <Send />
              {chosen.length > 0
                ? `Send ${chosen.length} to ${riders.find((r) => r.id === sendRider)?.name ?? 'a rider'}`
                : 'Send to a rider'}
            </Button>

            {sendBlocker ? (
              <p className="text-center text-xs text-muted-foreground">{sendBlocker}</p>
            ) : null}
          </>
        )}
      </div>

      <div className="space-y-1.5 border-t pt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Or load into the run picked on the left
        </p>
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
      </details>
    </div>
  )
}
