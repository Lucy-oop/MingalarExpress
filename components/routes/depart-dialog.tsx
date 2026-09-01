'use client'

import * as React from 'react'
import { Send, TriangleAlert } from 'lucide-react'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { OVERRIDE_REASON_MIN_LENGTH, validateOverrideReason } from '@/lib/routes/errors'
import { formatMmk } from '@/lib/utils'
import type { TripVolumeCheck } from '@/lib/pricing'

/**
 * The override modal for dispatching an under-minimum run.
 *
 * Design intent, because it is easy to get this wrong in either direction:
 *
 *  - It is NOT a confirmation. A dispatcher who has already decided to send a
 *    short run has a reason; the modal exists to capture it, because
 *    `depart_trip` writes it to `audit_log` and that record is the only way
 *    anyone later learns how often the rule is being bypassed.
 *
 *  - It is NOT a wall either. The primary button stays enabled and reachable —
 *    a dispatcher with 14 parcels and a customer promised same-day delivery is
 *    doing their job, not breaking a rule.
 *
 * The 10-character floor is validated here for instant feedback and again in
 * `depart_trip`'s CHECK. SQL is the authority; this is the courtesy.
 */
export function DepartDialog({
  open,
  onClose,
  onConfirm,
  routeName,
  volume,
  busy,
  error,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
  routeName: string
  volume: TripVolumeCheck
  busy: boolean
  error: string | null
}) {
  const [reason, setReason] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  // Reset per opening, so a reason typed for one run cannot be submitted for
  // another after the dialog is reopened.
  React.useEffect(() => {
    if (open) {
      setReason('')
      setTouched(false)
    }
  }, [open])

  const problem = validateOverrideReason(reason)
  const showProblem = touched && problem !== null
  const remaining = Math.max(0, OVERRIDE_REASON_MIN_LENGTH - reason.trim().length)

  const submit = () => {
    setTouched(true)
    if (problem) return
    onConfirm(reason.trim())
  }

  return (
    <Overlay
      open={open}
      onClose={onClose}
      side="center"
      title="Dispatch under minimum volume"
      description={`${routeName} · ${volume.parcels} of ${volume.minimum} parcels`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep loading
          </Button>
          <Button onClick={submit} disabled={busy}>
            <Send />
            {busy ? 'Dispatching…' : 'Dispatch anyway'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div
          className={
            volume.severity === 'loss'
              ? 'flex items-start gap-3 rounded-md border border-destructive/30 border-l-[3px] border-l-destructive bg-destructive/5 p-3 text-sm text-destructive'
              : 'flex items-start gap-3 rounded-md border border-amber-300 border-l-[3px] border-l-amber-500 bg-amber-50 p-3 text-sm text-amber-900'
          }
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <p className="font-medium">
              {volume.parcels} parcels — {volume.minimum - volume.parcels} short of the minimum
            </p>
            {/* The money, stated plainly. A dispatcher overriding the rule should
                see what it costs, and `depart_trip` records these same numbers. */}
            <p className="text-xs">
              Rider pay {formatMmk(volume.margin.riderPay)} against{' '}
              {formatMmk(volume.margin.revenue)} of fees ·{' '}
              {volume.margin.platform >= 0 ? (
                <>margin {formatMmk(volume.margin.platform)}</>
              ) : (
                <strong>loss {formatMmk(Math.abs(volume.margin.platform))}</strong>
              )}
              {volume.breakEven !== null ? ` · breaks even at ${volume.breakEven}` : ''}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="override-reason" className="text-sm font-medium">
            Why is this run going out short?
          </label>
          <Textarea
            id="override-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="e.g. Customer promised same-day on 4 downtown parcels; next run is tomorrow."
            aria-describedby="override-reason-help"
            aria-invalid={showProblem || undefined}
            autoFocus
          />
          <p id="override-reason-help" className="text-xs text-muted-foreground">
            {showProblem ? (
              <span className="text-destructive">{problem}</span>
            ) : remaining > 0 ? (
              `${remaining} more character${remaining === 1 ? '' : 's'} needed.`
            ) : (
              'Goes to the audit log with the parcel count and the projected margin.'
            )}
          </p>
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>
    </Overlay>
  )
}
