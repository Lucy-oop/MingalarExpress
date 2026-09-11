import { AlertTriangle, PackageCheck, TrendingDown } from 'lucide-react'
import { isVolumeSilent, type TripVolumeCheck } from '@/lib/pricing'

export { isVolumeSilent }
import { cn, formatMmk } from '@/lib/utils'

/**
 * Loaded-volume warning for a trip on the dispatcher board.
 *
 * Grades two separate things, because they are not the same question:
 *
 *   loss           revenue does not cover the rider's pay (under ~5–7 parcels)
 *   below_minimum  profitable, but under the 20-parcel operational rule
 *
 * A 14-parcel run genuinely makes money, so it gets the amber "under minimum"
 * note rather than a red alarm. Crying loss at 14 would teach a dispatcher to
 * ignore the banner — including at 6 parcels, where it is telling the truth.
 *
 * Renders nothing when the run is fine: a banner that is always present stops
 * being read.
 */
export function TripVolumeBanner({
  check,
  className,
}: {
  check: TripVolumeCheck
  className?: string
}) {
  if (check.severity === 'ok' || !check.message) return null

  const loss = check.severity === 'loss'
  const Icon = loss ? TrendingDown : AlertTriangle

  return (
    <div
      role={loss ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-md border p-3 text-sm',
        loss
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-amber-300 bg-amber-50 text-amber-900',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{check.message}</p>
        <p className="text-xs opacity-90">
          {loss ? (
            <>
              This run needs{' '}
              <strong>
                {check.breakEven === null ? 'more' : `${check.breakEven}`} parcels
              </strong>{' '}
              just to cover the rider&rsquo;s pay. Loading more, or moving these parcels onto
              another route, avoids paying out more than the fees collected.
            </>
          ) : (
            <>
              Still profitable — {formatMmk(check.margin.platform)} margin on{' '}
              {formatMmk(check.margin.revenue)} of fees — but below the{' '}
              {check.minimum}-parcel rule for sending a run out.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

/**
 * Compact counter for a trip row: "14/20 parcels".
 *
 * Separate from the banner so a list of trips can show state at a glance without
 * a paragraph of explanation per row.
 */
export function TripVolumePill({ check }: { check: TripVolumeCheck }) {
  const tone =
    check.severity === 'loss'
      ? 'border-destructive/30 bg-destructive/10 text-destructive'
      : check.severity === 'below_minimum'
        ? 'border-amber-300 bg-amber-100 text-amber-900'
        : 'border-emerald-300 bg-emerald-50 text-emerald-800'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums',
        tone,
      )}
      title={check.message ?? `Meets the ${check.minimum}-parcel minimum`}
    >
      {check.severity === 'ok' ? <PackageCheck className="size-3" aria-hidden="true" /> : null}
      {check.parcels}/{check.minimum} parcels
    </span>
  )
}
