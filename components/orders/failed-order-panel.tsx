'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CornerUpLeft, RotateCw, TriangleAlert } from 'lucide-react'
import {
  resolveFailedOrder,
  type OrderResolution,
} from '@/lib/orders/actions'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

/**
 * What the shop does about a parcel that failed delivery.
 *
 * TWO choices. There is no "refund" — a failed COD parcel collected no money, so
 * there is nothing in the system to give back; a shop asking for a refund wants
 * `return`. And "Cancel order" was removed deliberately: a parcel that has been
 * out on a run is a parcel the platform is holding, and the honest answers are
 * "try again" or "bring it back to me". Cancelling it leaves goods at the hub
 * belonging to nobody. A shop that genuinely wants the order gone cancels it
 * while it is still `pending`, which `CancelOrderButton` does; past that the
 * office does it by hand, on the phone, with a note in the contact log.
 *
 * `resolve_failed_order` still ACCEPTS 'cancel' — the RPC has other callers and
 * the office needs it — so this is a narrowing of the shop's choices, not of the
 * system's.
 *
 * The copy is careful about one thing in particular. Until now a failure was
 * retried automatically and silently, so a shop had no idea it was happening.
 * The panel states the automatic behaviour ("we will try again on the next run")
 * before offering the buttons, because the most common correct answer is to do
 * nothing, and a shop should be able to see that and close the tab.
 *
 * No return fee is charged or mentioned. Deliberate at this stage: the platform
 * absorbs the cost of a failed attempt to keep friction off the shop.
 */

const CHOICES: Array<{
  value: OrderResolution
  label: string
  hint: string
  icon: typeof RotateCw
  variant: 'default' | 'outline' | 'ghost'
  confirm: string
}> = [
  {
    value: 'retry',
    label: 'Try again',
    hint: 'Back in the queue for the next run.',
    icon: RotateCw,
    variant: 'default',
    confirm: 'Put this parcel back in the queue?',
  },
  {
    value: 'return',
    label: 'Return to me',
    hint: 'We stop delivering and bring it back.',
    icon: CornerUpLeft,
    variant: 'outline',
    confirm: 'Stop delivering and return this parcel to you?',
  },
]

export function FailedOrderPanel({
  orderId,
  orderCode,
  failReason,
  attempts,
  maxAttempts,
  uncollected,
  maxCollectionAttempts,
  neverCollected,
  awaitingDecision,
  resolution,
  status,
  receivedBy,
}: {
  orderId: string
  orderCode: string
  failReason: string | null
  attempts: number
  maxAttempts: number
  /** Trips to the shop that came away empty: assigned -> failed (0018). */
  uncollected: number
  maxCollectionAttempts: number
  /** Failed, but never past pickup — so it is still on the shop's own shelf. */
  neverCollected: boolean
  awaitingDecision: boolean
  resolution: string | null
  status: string
  /** Who at the shop signed for it, once a return has actually arrived. */
  receivedBy: string | null
}) {
  const router = useRouter()
  const [choice, setChoice] = React.useState<(typeof CHOICES)[number] | null>(null)
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const submit = async () => {
    if (!choice) return
    setBusy(true)
    setError(null)
    const result = await resolveFailedOrder(orderId, choice.value, note)
    setBusy(false)

    if (!result.ok) {
      setError(result.message)
      return
    }
    setChoice(null)
    router.refresh()
  }

  // Once the parcel is physically back, the decision is history — say what
  // happened rather than what was asked for.
  if (status === 'returned') {
    return (
      <Alert tone="success" title="Back with you">
        {receivedBy
          ? `Returned to your shop and signed for by ${receivedBy}.`
          : 'This parcel has been returned to your shop.'}
      </Alert>
    )
  }

  // A decision already made needs reporting, not re-asking.
  if (resolution) {
    return (
      <Alert
        tone={resolution === 'cancel' ? 'info' : 'success'}
        title={
          resolution === 'retry'
            ? 'You asked us to try again'
            : resolution === 'return'
              ? 'Coming back to you'
              : 'This order was cancelled'
        }
      >
        {resolution === 'retry'
          ? 'It is back in the queue and will go out on the next run to that area.'
          : resolution === 'return'
            ? 'We have stopped delivering it. The office will arrange to get it back to you.'
            : 'Nothing further will happen to this parcel.'}
      </Alert>
    )
  }

  // A parcel we never collected is already where a return would take it, and
  // `resolve_failed_order` refuses that combination outright — so it is not
  // offered rather than offered and rejected.
  const choices = neverCollected ? CHOICES.filter((c) => c.value !== 'return') : CHOICES

  // Two ceilings since 0018. A shop that was shut twice has burned collection
  // attempts, not delivery attempts, and telling them "attempt 2 of 3" about a
  // delivery nobody tried is exactly the unfairness that change fixed.
  const tries = neverCollected ? uncollected : attempts
  const ceiling = neverCollected ? maxCollectionAttempts : maxAttempts
  const remaining = Math.max(0, ceiling - tries)

  return (
    <>
      <Card className="border-amber-300 bg-amber-50/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base text-amber-900">
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
            {awaitingDecision
              ? 'This parcel needs your decision'
              : neverCollected
                ? 'We could not collect this parcel'
                : 'Delivery failed'}
            <Badge tone="amber">
              {neverCollected ? 'Collection' : 'Delivery'} attempt {tries} of {ceiling}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {/* Where the parcel physically is — the first thing a shop wants to
              know and the thing the old panel never said. */}
          <p className="text-amber-900">
            {neverCollected
              ? 'Our rider could not collect it, so it is still at your shop.'
              : 'Your parcel is safe with us and back at the hub.'}
          </p>

          {failReason ? (
            <p className="text-amber-900">
              <span className="font-medium">Reason given:</span> {failReason}
            </p>
          ) : null}

          {/*
            State the default before offering the buttons. Doing nothing is the
            right answer most of the time — an unanswered phone is worth another
            try — and a shop should be able to read that and close the tab.
          */}
          <p className="text-muted-foreground">
            {awaitingDecision
              ? `We have tried ${tries} time${tries === 1 ? '' : 's'} and stopped. Nothing more will happen until you choose.`
              : remaining > 0
                ? `We will try again automatically on the next run — ${remaining} more attempt${remaining === 1 ? '' : 's'} before we stop and ask you.`
                : 'We will not try again automatically. Choose what happens next.'}
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            {choices.map((c) => (
              <Button
                key={c.value}
                variant={c.variant}
                size="sm"
                onClick={() => {
                  setNote('')
                  setError(null)
                  setChoice(c)
                }}
              >
                <c.icon />
                {c.label}
              </Button>
            ))}
          </div>
          <dl className="space-y-0.5 text-xs text-muted-foreground">
            {choices.map((c) => (
              <div key={c.value} className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium">{c.label}</dt>
                <dd>{c.hint}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Overlay
        open={choice !== null}
        onClose={() => setChoice(null)}
        side="center"
        title={choice?.confirm ?? ''}
        description={orderCode}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setChoice(null)} disabled={busy}>
              Go back
            </Button>
            <Button
              variant={choice?.value === 'cancel' ? 'destructive' : 'default'}
              onClick={() => void submit()}
              disabled={busy}
            >
              {busy ? 'Saving…' : (choice?.label ?? 'Confirm')}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{choice?.hint}</p>
          <div className="space-y-1.5">
            <label htmlFor="resolution-note" className="text-sm font-medium">
              Anything to add?{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id="resolution-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                choice?.value === 'retry'
                  ? 'e.g. Customer says try after 5pm'
                  : 'e.g. Customer refused it'
              }
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Saved with the order and visible to the office.
            </p>
          </div>
          {error ? <Alert tone="error">{error}</Alert> : null}
        </div>
      </Overlay>
    </>
  )
}
