'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Banknote, Bike, FileX } from 'lucide-react'
import { resolveRejectedKpay, type KpayRejected, type KpayResolution } from '@/lib/admin/kpay'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTimeYangon, formatMmk, formatMyanmarPhone } from '@/lib/utils'

const CHOICE: Record<
  KpayResolution,
  { label: string; title: string; explain: string; noteLabel: string; noteRequired: boolean }
> = {
  cash_collected: {
    label: 'Cash collected by office',
    title: 'The office collected this money',
    explain:
      'The customer paid the office directly. The parcel is cleared, and the shop can be paid its goods value.',
    noteLabel: 'How it was paid (optional)',
    noteRequired: false,
  },
  charged_rider: {
    label: 'Charge to rider',
    title: 'Charge this to the rider',
    explain:
      "Books the full amount as a cash-shortfall deduction on the rider's payroll this month. The parcel is cleared.",
    noteLabel: 'Reason (optional)',
    noteRequired: false,
  },
  written_off: {
    label: 'Write off',
    title: 'Write this off as a loss',
    explain:
      'Mingalar Express absorbs the loss. It is recorded permanently as bad debt; the shop is still paid for goods that were delivered.',
    noteLabel: 'Why it is being written off',
    noteRequired: true,
  },
}

/**
 * Rejected KBZPay payments waiting for someone to decide what happens (0058).
 *
 * A rejection used to be the end of the road: the parcel sat "unreceived"
 * with no owner. Each one now leaves this list one of three ways, once, and
 * every resolution is audited.
 */
export function KpayRejectedQueue({ items }: { items: KpayRejected[] }) {
  const router = useRouter()
  const [choice, setChoice] = React.useState<{ item: KpayRejected; resolution: KpayResolution } | null>(null)
  const [note, setNote] = React.useState('')
  const [feedback, setFeedback] = React.useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [pending, startTransition] = React.useTransition()

  const total = items.reduce((sum, i) => sum + i.codAmount, 0)
  const spec = choice ? CHOICE[choice.resolution] : null

  return (
    <Card className={items.length > 0 ? 'border-amber-300' : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className="size-4 text-amber-600" />
          Rejected — needs resolving ({items.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {items.length > 0
            ? `${formatMmk(total)} delivered but not received. Decide each one: collected by the office, charged to the rider, or written off.`
            : 'No rejected KBZPay payments waiting.'}
        </p>
      </CardHeader>
      {feedback ? (
        <div className="px-4 pb-3">
          <Alert tone={feedback.tone}>{feedback.message}</Alert>
        </div>
      ) : null}
      {items.length > 0 ? (
        <CardContent className="p-0">
          <ul className="divide-y border-t">
            {items.map((item) => (
              <li key={item.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono font-semibold">{item.code}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.customerName} · {formatMyanmarPhone(item.customerPhone)}
                      {item.shopName ? ` · ${item.shopName}` : ''}
                      {item.riderName ? ` · rider ${item.riderName}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Rejected {formatDateTimeYangon(item.rejectedAt)}
                      {item.rejectReason ? ` — ${item.rejectReason}` : ''}
                    </p>
                  </div>
                  <span className="text-lg font-semibold tabular-nums">{formatMmk(item.codAmount)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setNote('')
                      setChoice({ item, resolution: 'cash_collected' })
                    }}
                  >
                    <Banknote />
                    {CHOICE.cash_collected.label}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || !item.hasRider}
                    title={item.hasRider ? undefined : 'No rider is recorded on this parcel'}
                    onClick={() => {
                      setNote('')
                      setChoice({ item, resolution: 'charged_rider' })
                    }}
                  >
                    <Bike />
                    {CHOICE.charged_rider.label}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setNote('')
                      setChoice({ item, resolution: 'written_off' })
                    }}
                  >
                    <FileX />
                    {CHOICE.written_off.label}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      ) : null}

      <Overlay
        open={choice !== null}
        onClose={() => setChoice(null)}
        side="center"
        title={spec ? `${spec.title} · ${choice?.item.code}` : ''}
        description={choice ? formatMmk(choice.item.codAmount) : undefined}
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={() => setChoice(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending || (spec?.noteRequired === true && note.trim().length < 3)}
              onClick={() =>
                choice &&
                startTransition(async () => {
                  setFeedback(null)
                  const r = await resolveRejectedKpay(choice.item.id, choice.resolution, note)
                  setFeedback({ tone: r.ok ? 'success' : 'error', message: r.message })
                  if (r.ok) {
                    setChoice(null)
                    router.refresh()
                  }
                })
              }
            >
              {pending ? 'Saving…' : 'Confirm'}
            </Button>
          </div>
        }
      >
        {spec ? (
          <div className="space-y-3">
            <p className="text-sm">{spec.explain}</p>
            <Field label={spec.noteLabel} htmlFor="kpayNote" required={spec.noteRequired}>
              <Input id="kpayNote" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground">
              This is final and written to the audit log. It cannot be changed afterwards.
            </p>
          </div>
        ) : null}
      </Overlay>
    </Card>
  )
}
