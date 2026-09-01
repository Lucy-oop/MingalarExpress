'use client'

import { useState } from 'react'
import { Power, Satellite, TriangleAlert } from 'lucide-react'
import { useRiderBeacon } from '@/lib/rider/use-rider-beacon'
import { cn } from '@/lib/utils'

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
  const { online, position, geoError, pending, toggle } = useRiderBeacon(riderId, initialOnline)
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
          'flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors',
          online
            ? 'bg-emerald-600 text-white'
            : 'border border-dashed bg-card text-muted-foreground',
        )}
      >
        <span className="flex items-center gap-3">
          <Power className={cn('size-5', pending && 'animate-pulse')} />
          <span>
            <span className="block font-semibold">{online ? 'Online' : 'Offline'}</span>
            <span className={cn('block text-xs', online ? 'text-white/80' : 'text-muted-foreground')}>
              {pending
                ? 'Saving…'
                : online
                  ? 'Dispatch can see you'
                  : 'Tap to start receiving jobs'}
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
            ? `GPS locked · ±${Math.round(position.accuracy)} m`
            : 'Waiting for a GPS fix…'}
        </p>
      ) : null}

      {geoError ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {geoError}
        </p>
      ) : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  )
}
