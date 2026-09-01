import { Check, CircleDashed, TriangleAlert, X } from 'lucide-react'
import { ORDER_CHECKPOINTS, ORDER_STATUS_LABEL, type OrderStatus } from '@/types/domain'
import { formatDateTimeYangon } from '@/lib/utils'
import { cn } from '@/lib/utils'

export type TimelineEvent = { status: OrderStatus; at: string }

/**
 * Checkpoint timeline. Renders the four happy-path checkpoints and appends
 * `failed`/`cancelled` as a terminal step when they occurred -- they are not
 * part of the sequence, so slotting them inline would misrepresent progress.
 */
export function StatusTimeline({
  current,
  events,
}: {
  current: OrderStatus
  events: TimelineEvent[]
}) {
  const stampFor = (s: OrderStatus) => events.find((e) => e.status === s)?.at ?? null
  const reachedIndex = ORDER_CHECKPOINTS.indexOf(current)
  const isBroken = current === 'failed' || current === 'cancelled'

  return (
    <ol className="space-y-0">
      {ORDER_CHECKPOINTS.map((step, i) => {
        const stamp = stampFor(step)
        const done = stamp !== null || (reachedIndex >= 0 && i <= reachedIndex)
        const isLast = i === ORDER_CHECKPOINTS.length - 1
        return (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border',
                  done
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-border bg-background text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" /> : <CircleDashed className="size-3.5" />}
              </span>
              {!isLast ? (
                <span
                  className={cn('my-0.5 w-px flex-1', done ? 'bg-emerald-600/40' : 'bg-border')}
                />
              ) : null}
            </div>
            <div className={cn('pb-4', isLast && 'pb-0')}>
              <p className={cn('text-sm font-medium', !done && 'text-muted-foreground')}>
                {ORDER_STATUS_LABEL[step]}
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {stamp ? formatDateTimeYangon(stamp) : '—'}
              </p>
            </div>
          </li>
        )
      })}

      {isBroken ? (
        <li className="flex gap-3 pt-1">
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-white',
              current === 'failed' ? 'bg-amber-500' : 'bg-destructive',
            )}
          >
            {current === 'failed' ? (
              <TriangleAlert className="size-3.5" />
            ) : (
              <X className="size-3.5" />
            )}
          </span>
          <div>
            <p className="text-sm font-medium">{ORDER_STATUS_LABEL[current]}</p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {formatDateTimeYangon(stampFor(current))}
            </p>
          </div>
        </li>
      ) : null}
    </ol>
  )
}
