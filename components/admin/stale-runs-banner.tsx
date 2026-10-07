import { AlertTriangle } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { formatDateTimeYangon, formatMmk } from '@/lib/utils'
import { wayLabel } from '@/lib/routes/ways'
import type { StaleRun } from '@/lib/routes/queries'

/**
 * The overnight / stale-run warning (0058), on the Ways board and COD audit.
 *
 * Renders NOTHING when there is nothing stale: a banner that is always there
 * teaches everyone to ignore the day it matters.
 */
export function StaleRunsBanner({ runs, where }: { runs: StaleRun[]; where: 'board' | 'audit' }) {
  if (runs.length === 0) return null
  const cash = runs.reduce((sum, r) => sum + r.cashOnRun, 0)

  return (
    <Alert
      tone="error"
      title={`${runs.length} run${runs.length === 1 ? '' : 's'} open too long${cash > 0 ? ` · ${formatMmk(cash)} not yet deposited` : ''}`}
    >
      <ul className="mt-1 space-y-1 text-xs">
        {runs.map((r) => (
          <li key={r.tripId} className="flex flex-wrap items-center gap-x-2">
            <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
            <span className="font-semibold">{wayLabel(r.routeCode)}</span>
            <span>{r.riderName ?? 'no rider'}</span>
            <span className="text-muted-foreground">
              open {r.hoursOpen}h since {formatDateTimeYangon(r.openedAt)}
            </span>
            {r.cashOnRun > 0 ? (
              <span className="font-medium">
                carrying {formatMmk(r.cashOnRun)}
                {r.overnightCash ? ' overnight' : ''}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs">
        {where === 'board'
          ? 'Bring each rider in: receive what they collected, then Close run & deposit cash.'
          : 'Cash on these runs is not yet in the office. Close each run on the Ways board to deposit it.'}
      </p>
    </Alert>
  )
}
