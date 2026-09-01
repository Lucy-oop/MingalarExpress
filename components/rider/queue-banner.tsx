'use client'

import { CloudOff, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOfflineQueue } from '@/lib/rider/use-offline-queue'
import { cn } from '@/lib/utils'

const LABELS: Record<string, string> = {
  picked_up: 'Pickup',
  delivered: 'Delivery',
  failed: 'Failed delivery',
}

/**
 * Persistent, honest indicator of unsent work.
 *
 * A rider must be able to tell "the office knows" from "my phone knows" — that
 * distinction is what stops them from re-delivering a parcel or arguing about a
 * COD balance at settlement.
 */
export function QueueBanner() {
  const { queue, flushing, lastError, flush, clearError } = useOfflineQueue()

  if (queue.length === 0 && !lastError) return null

  return (
    <div
      className={cn(
        'rounded-lg border p-3 text-sm',
        lastError ? 'border-destructive/40 bg-destructive/5' : 'border-amber-300 bg-amber-50',
      )}
      role="status"
    >
      {queue.length > 0 ? (
        <>
          <p className="flex items-center gap-2 font-medium text-amber-900">
            {flushing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CloudOff className="size-4" />
            )}
            {queue.length} update{queue.length === 1 ? '' : 's'} waiting to send
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-amber-900/80">
            {queue.slice(0, 4).map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2">
                <span>
                  {LABELS[item.kind] ?? item.kind} · {item.orderCode}
                  {item.proof ? ' (with photo)' : ''}
                </span>
                {item.attempts > 0 ? <span>retry {item.attempts}</span> : null}
              </li>
            ))}
            {queue.length > 4 ? <li>and {queue.length - 4} more…</li> : null}
          </ul>
          <p className="mt-1.5 text-xs text-amber-900/70">
            Saved on your phone. Keep the app open when you get signal.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={flushing}
            onClick={() => void flush()}
          >
            <RefreshCw className={cn(flushing && 'animate-spin')} />
            Try now
          </Button>
        </>
      ) : null}

      {lastError ? (
        <div className={cn(queue.length > 0 && 'mt-2 border-t pt-2')}>
          <p className="text-xs font-medium text-destructive">
            One update could not be saved and was discarded. Tell your dispatcher.
          </p>
          <Button variant="ghost" size="sm" className="mt-1" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  )
}
