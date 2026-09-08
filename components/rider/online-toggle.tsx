'use client'

import { useState } from 'react'
import { Power, Satellite } from 'lucide-react'
import { useRiderBeacon } from '@/lib/rider/use-rider-beacon'
import { cn } from '@/lib/utils'
import { useT } from '@/components/shared/i18n-provider'

/**
 * The single most important control in the rider app: while it is off, dispatch
 * cannot see the rider and `nearby_available_riders` will not return them.
 *
 * State is optimistic with rollback — a rider on a bad connection must not be
 * left staring at a toggle that did not visibly move.
 */
export function OnlineToggle({
  riderId,
  initialOnline,
  onOnlineChange,
}: {
  riderId: string
  initialOnline: boolean
  onOnlineChange?: (online: boolean) => void
}) {
  const t = useT()
  const { online, position, pending, toggle } = useRiderBeacon(riderId, initialOnline)
  const [error, setError] = useState<string | null>(null)

  const handleToggle = async () => {
    setError(null)
    const result = await toggle(!online)
    if (!result.ok) setError(result.message)
    else onOnlineChange?.(!online)
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void handleToggle()}
        disabled={pending}
        aria-pressed={online}
        className={cn(
          // 72px tall. This is the control a rider hits first thing in the
          // morning with gloves on, and the one that decides whether they get
          // any work at all.
          'flex min-h-18 w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors',
          online
            ? 'bg-emerald-600 text-white'
            : 'border border-dashed bg-card text-muted-foreground',
        )}
      >
        <span className="flex items-center gap-3">
          <Power className={cn('size-7', pending && 'animate-pulse')} />
          <span>
            <span className="block text-lg font-bold">
              {online ? t('online.on') : t('online.goOn')}
            </span>
            <span className={cn('block text-sm', online ? 'text-white/80' : 'text-muted-foreground')}>
              {pending
                ? t('action.saving')
                : online
                  ? t('online.visible')
                  : t('online.tapToStart')}
            </span>
          </span>
        </span>
        <span
          className={cn(
            'relative h-7 w-12 shrink-0 rounded-full transition-colors',
            online ? 'bg-white/30' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'absolute top-1 size-5 rounded-full bg-white shadow transition-all',
              online ? 'left-6' : 'left-1',
            )}
          />
        </span>
      </button>

      {online ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Satellite className="size-3.5" />
          {position
            ? `${t('online.gpsLocked')} · ±${Math.round(position.accuracy)} m`
            : t('online.gpsWaiting')}
        </p>
      ) : null}

      {/*
        THE GEO ERROR IS NOT PRINTED. "Location permission denied. Dispatch
        cannot see you." sat here as an amber alert under the control, and it
        was the loudest thing on the rider's first screen -- above the shops,
        above the stops, on every render where the browser had not handed over
        a fix. Which includes indoors, in a stairwell, and the first few
        seconds of every shift.

        The sub-label above already tells the same truth without shouting: it
        reads "GPS on - ±12 m" when there is a fix and "Waiting for GPS..."
        when there is not, whatever the reason. A rider who never leaves
        "Waiting" learns more from that than from a red sentence naming an API
        error code they cannot act on.

        `useRiderBeacon` still exposes `geoError` -- the beacon knows WHY, and
        a caller that needs the reason (a diagnostics screen, dispatch-side)
        can read it. This screen deliberately does not.
      */}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  )
}
