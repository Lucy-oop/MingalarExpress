'use client'

import * as React from 'react'
import { Check, TriangleAlert, UserRound } from 'lucide-react'
import { Select } from '@/components/ui/select'
import { cn, formatMmk } from '@/lib/utils'
import type { BoardRider } from '@/lib/routes/queries'

/**
 * Who is riding this run — one tap, in the card header.
 *
 * WHAT IT REPLACES. A native <select> inside the card's collapsed body, whose
 * options concatenated every rider fact into one flat string:
 *
 *     Ko Aung · YGN-1234 — already out — offline · holding 480,000 Ks
 *
 * in a 256px control, where the money truncates first. Two separators carried
 * three meanings, an <option> cannot be styled, and on a `planned` card the
 * whole thing did not exist until you clicked the chevron. Assignment is the
 * most consequential thing on this board and it was the least visible.
 *
 * WHAT IS DELIBERATELY NOT A RULE HERE. Only `onOpenTrip` disables a rider, and
 * only because it mirrors the `trips_rider_open_uk` index exactly -- same three
 * statuses -- so it predicts an `assign_trip_rider` rejection with certainty.
 * Offline riders and riders over their float limit stay SELECTABLE: the server
 * does not refuse either, and a picker that blocks what the server allows
 * teaches dispatchers that the board is lying to them. They are marked, not
 * barred. Nor are unavailable riders hidden -- getBoardRiders is explicit that
 * "a rider who is simply absent from the list explains nothing".
 */

/** Above this many, a row of chips stops being scannable and becomes a wall. */
const CHIP_LIMIT = 8

export function RiderPicker({
  riders,
  riderId,
  riderName,
  editable,
  busy,
  /** Parcels already aboard — a swap re-stamps every one of them. */
  loadedCount,
  onAssign,
}: {
  riders: BoardRider[]
  riderId: string | null
  riderName: string | null
  editable: boolean
  busy: boolean
  loadedCount: number
  onAssign: (riderId: string) => void
}) {
  // Once a run has left, the rider is a fact rather than a choice.
  if (!editable) {
    return (
      <p className="flex items-center gap-1.5 text-sm">
        <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{riderName ?? 'No rider'}</span>
      </p>
    )
  }

  const choose = (id: string) => {
    if (id === riderId) return
    /*
      Confirm a SWAP, never a first assignment. Changing the rider re-stamps
      every order on the run (assign_trip_rider, 0015) -- the parcels, the COD
      status and who gets paid all move -- so it deserves a pause. A first
      assignment is the frictionless thing this redesign exists to protect.
    */
    if (riderId && loadedCount > 0) {
      const from = riders.find((r) => r.id === riderId)?.name ?? 'the current rider'
      const to = riders.find((r) => r.id === id)?.name ?? 'this rider'
      const ok = window.confirm(
        `Move all ${loadedCount} parcel${loadedCount === 1 ? '' : 's'} from ${from} to ${to}?\n\n` +
          'Every parcel on this run is reassigned, including any cash still to collect.',
      )
      if (!ok) return
    }
    onAssign(id)
  }

  const tooMany = riders.length > CHIP_LIMIT
  // Above the limit, the free riders stay one tap away and the rest fall back to
  // the OS picker, so the control degrades instead of breaking.
  const chips = tooMany
    ? riders.filter((r) => r.id === riderId || (!r.onOpenTrip && r.isOnline))
    : riders

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {riderId ? null : (
        <span className="flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">
          <TriangleAlert className="size-3.5" aria-hidden="true" />
          Assign a rider
        </span>
      )}

      {chips.map((r) => (
        <RiderChip
          key={r.id}
          rider={r}
          current={r.id === riderId}
          busy={busy}
          onClick={() => choose(r.id)}
        />
      ))}

      {tooMany ? (
        <Select
          value=""
          onChange={(e) => e.target.value && choose(e.target.value)}
          disabled={busy}
          className="h-9 w-44"
          aria-label="Other riders"
        >
          <option value="">Other riders…</option>
          {riders
            .filter((r) => !chips.some((c) => c.id === r.id))
            .map((r) => (
              <option key={r.id} value={r.id} disabled={r.onOpenTrip}>
                {r.name}
                {r.onOpenTrip ? ' — already out' : ''}
                {!r.isOnline ? ' — offline' : ''}
              </option>
            ))}
        </Select>
      ) : null}
    </div>
  )
}

function RiderChip({
  rider,
  current,
  busy,
  onClick,
}: {
  rider: BoardRider
  current: boolean
  busy: boolean
  onClick: () => void
}) {
  // The only hard rule, and only because it mirrors trips_rider_open_uk.
  const barred = rider.onOpenTrip && !current
  const overFloat = rider.codFloatLimit > 0 && rider.codInHand >= rider.codFloatLimit

  // One line of context, in priority order — never all of them at once, which
  // is what made the old <option> unreadable.
  const note = barred
    ? 'on a run'
    : overFloat
      ? `holding ${formatMmk(rider.codInHand)}`
      : !rider.isOnline
        ? 'offline'
        : (rider.vehiclePlate ?? '')

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || barred}
      aria-pressed={current}
      title={barred ? `${rider.name} is already out on another run` : undefined}
      className={cn(
        'flex min-h-11 shrink-0 flex-col items-start justify-center rounded-md border px-2.5 py-1 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        current
          ? 'border-primary bg-primary text-primary-foreground'
          : 'bg-background hover:bg-muted',
        barred && 'cursor-not-allowed opacity-50 hover:bg-background',
      )}
    >
      <span className="flex items-center gap-1 text-xs font-semibold leading-tight">
        {current ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}
        {rider.name}
      </span>
      {note ? (
        <span
          className={cn(
            'text-[10px] leading-tight',
            current
              ? 'text-primary-foreground/80'
              : overFloat && !barred
                ? 'font-medium text-amber-700'
                : 'text-muted-foreground',
          )}
        >
          {note}
        </span>
      ) : null}
    </button>
  )
}
