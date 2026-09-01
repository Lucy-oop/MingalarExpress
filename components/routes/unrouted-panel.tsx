'use client'

import * as React from 'react'
import { Coins, MapPin, PackageOpen, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn, formatMmk } from '@/lib/utils'
import type { BoardRoute, UnroutedParcel } from '@/lib/routes/queries'

/**
 * Parcels not yet on a run, grouped by the area they are going to.
 *
 * Grouped by AREA rather than by shop or by age because that is how a run is
 * built: everything for မြောက်ဥက္ကလာ goes on the same bike, and a dispatcher
 * wants to tick a whole township at once. The group header carries a select-all
 * for exactly that.
 *
 * Each group is labelled with the route its area maps to by default
 * (`route_areas.is_primary`), and the "This route only" filter uses it — so the
 * usual workflow is: pick a run, filter to it, tick all, load.
 */
export function UnroutedPanel({
  parcels,
  routes,
  selected,
  onToggle,
  onToggleMany,
  onClear,
  /** Route of the run currently being built, for the default filter. */
  focusRouteId,
}: {
  parcels: UnroutedParcel[]
  routes: BoardRoute[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleMany: (ids: string[], select: boolean) => void
  onClear: () => void
  focusRouteId: string | null
}) {
  const [query, setQuery] = React.useState('')
  const [routeFilter, setRouteFilter] = React.useState<string>('')

  // Reset the filter when the dispatcher switches which run they are building,
  // otherwise the panel silently keeps showing another route's parcels.
  React.useEffect(() => {
    setRouteFilter(focusRouteId ?? '')
  }, [focusRouteId])

  const routeById = React.useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes])

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return parcels.filter((p) => {
      // '__none' is its own case: a parcel whose area maps to no route cannot be
      // loaded anywhere and needs surfacing, not hiding.
      if (routeFilter === '__none') {
        if (p.suggestedRouteId !== null) return false
      } else if (routeFilter && p.suggestedRouteId !== routeFilter) {
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
  }, [parcels, query, routeFilter])

  /** Area groups, ordered by the stop sequence of the route they belong to. */
  const groups = React.useMemo(() => {
    const map = new Map<string, { label: string; routeId: string | null; items: UnroutedParcel[] }>()
    for (const p of visible) {
      const key = p.areaId ?? 'unmapped'
      const entry = map.get(key) ?? {
        label: p.areaName ?? 'No area set',
        routeId: p.suggestedRouteId,
        items: [],
      }
      entry.items.push(p)
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => {
      const ra = a.routeId ? routeById.get(a.routeId)?.sortOrder ?? 999 : 999
      const rb = b.routeId ? routeById.get(b.routeId)?.sortOrder ?? 999 : 999
      return ra - rb || a.label.localeCompare(b.label)
    })
  }, [visible, routeById])

  const selectedVisible = visible.filter((p) => selected.has(p.id)).length

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
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
          {visible.length} of {parcels.length} unrouted
          {selectedVisible > 0 ? ` · ${selected.size} ticked` : ''}
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
              {parcels.length > 0
                ? 'No parcels match this filter.'
                : 'Every parcel is on a run.'}
            </p>
          </div>
        ) : (
          groups.map((group) => {
            const ids = group.items.map((p) => p.id)
            const allSelected = ids.every((id) => selected.has(id))
            const route = group.routeId ? routeById.get(group.routeId) : null
            const cod = group.items.reduce((sum, p) => sum + p.codAmount, 0)

            return (
              <section key={group.label} className="rounded-lg border">
                <header className="flex items-center gap-2 border-b bg-muted/40 p-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => onToggleMany(ids, !allSelected)}
                    className="size-4 shrink-0 accent-brand-red"
                    aria-label={`Select all ${group.items.length} parcels for ${group.label}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <MapPin className="size-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{group.label}</span>
                    </span>
                  </span>
                  {route ? (
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
                              {p.status === 'failed' ? <Badge tone="red">Retry</Badge> : null}
                              {p.isFragile ? <Badge tone="amber">Fragile</Badge> : null}
                            </span>
                            <span className="block truncate text-muted-foreground">
                              {p.customerName} · {p.dropoffAddress}
                            </span>
                          </span>
                          <span className="shrink-0 text-right tabular-nums">
                            {p.paymentMethod === 'cod' ? (
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
    </div>
  )
}
