import { Check, CircleDashed, CornerUpLeft, PackageX, TriangleAlert, X } from 'lucide-react'
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/types/domain'
import {
  buildTimeline,
  describeTerminal,
  type TimelineAudience,
  type TimelineEvent,
} from '@/lib/orders/timeline'
import { formatDateTimeYangon } from '@/lib/utils'
import { cn } from '@/lib/utils'

export type { TimelineEvent }

/**
 * Checkpoint timeline. All the reasoning lives in `lib/orders/timeline`, which
 * is unit-tested; this file only draws it.
 *
 * The rule it now follows: a checkpoint is ticked because it HAPPENED, never
 * because the parcel has moved past it. That leaves one case looking odd on
 * purpose — a failure with `Picked up` greyed out — and rather than tick a
 * pickup that never occurred, the terminal step says which failure it was:
 *
 *   collected, then failed  "Your parcel is safe with us and back at the hub."
 *   never collected         "It is still at your shop."
 *
 * The second is the reassuring one, and it is the one that used to read as "we
 * have lost your parcel".
 */
export function StatusTimeline({
  current,
  events,
  reason,
  maxAttempts,
  maxCollectionAttempts,
  audience = 'shop',
}: {
  current: OrderStatus
  events: TimelineEvent[]
  /** Why it failed or was cancelled. Shown on the terminal step only. */
  reason?: string | null
  /** Enables "attempt 2 of 3" on a failure. Omitted on the public track page. */
  maxAttempts?: number
  /** The other ceiling (0018). Used when the parcel was never collected. */
  maxCollectionAttempts?: number
  /** `customer` drops custody detail and the attempt count — see describeTerminal. */
  audience?: TimelineAudience
}) {
  const { steps, terminal, attempt, collected } = buildTimeline(current, events)
  // The odd-looking gap is only worth explaining to the shop; a customer has no
  // use for "the rider could not collect it".
  const failedUncollected =
    audience === 'shop' && terminal?.status === 'failed' && !collected
  const described = terminal ? describeTerminal(terminal.status, collected, audience) : null
  // Two ceilings since 0018, and the wrong one is worse than none: telling a
  // shop "delivery attempt 2 of 3" about a parcel nobody collected is the
  // unfairness that migration set out to fix.
  const ceiling = collected ? maxAttempts : (maxCollectionAttempts ?? maxAttempts)

  return (
    <ol className="space-y-0">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1
        // The one step that needs explaining rather than a dash.
        const explainGap = failedUncollected && step.status === 'picked_up'
        return (
          <li key={step.status} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border',
                  step.done
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : explainGap
                      ? 'border-amber-400 bg-amber-50 text-amber-700'
                      : 'border-border bg-background text-muted-foreground',
                )}
              >
                {step.done ? (
                  <Check className="size-3.5" />
                ) : explainGap ? (
                  <PackageX className="size-3.5" />
                ) : (
                  <CircleDashed className="size-3.5" />
                )}
              </span>
              {!isLast ? (
                <span
                  className={cn('my-0.5 w-px flex-1', step.done ? 'bg-emerald-600/40' : 'bg-border')}
                />
              ) : null}
            </div>
            <div className={cn('pb-4', isLast && 'pb-0')}>
              <p
                className={cn(
                  'text-sm font-medium',
                  !step.done && (explainGap ? 'text-amber-900' : 'text-muted-foreground'),
                )}
              >
                {ORDER_STATUS_LABEL[step.status]}
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {step.at
                  ? formatDateTimeYangon(step.at)
                  : explainGap
                    ? 'Never collected — still at the shop'
                    : '—'}
              </p>
            </div>
          </li>
        )
      })}

      {terminal ? (
        <li className="flex gap-3 pt-1">
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-white',
              terminal.status === 'failed'
                ? 'bg-amber-500'
                : terminal.status === 'returned'
                  ? 'bg-blue-600'
                  : 'bg-destructive',
            )}
          >
            {terminal.status === 'failed' ? (
              <TriangleAlert className="size-3.5" />
            ) : terminal.status === 'returned' ? (
              <CornerUpLeft className="size-3.5" />
            ) : (
              <X className="size-3.5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {described!.title}
              {audience === 'shop' && terminal.status === 'failed' && ceiling ? (
                <span className="font-normal text-muted-foreground">
                  {' '}
                  · attempt {attempt} of {ceiling}
                </span>
              ) : null}
            </p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {formatDateTimeYangon(terminal.at)}
            </p>
            {/* Where the parcel physically is. The single most common support
                question, and the timeline used to leave it to the imagination. */}
            {described!.detail ? (
              <p className="mt-0.5 text-xs text-foreground">{described!.detail}</p>
            ) : null}
            {/* The reason was always recorded and never rendered, so a timeline
                ending in "Failed" told nobody anything they could act on. */}
            {reason ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Reason given: {reason}
              </p>
            ) : null}
          </div>
        </li>
      ) : null}
    </ol>
  )
}
