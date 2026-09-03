'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bike, Check, ExternalLink, Store, X } from 'lucide-react'
import { confirmKpay, rejectKpay, type KpayPending } from '@/lib/admin/kpay'
import { Button } from '@/components/ui/button'
import { Overlay } from '@/components/ui/overlay'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { formatDateTimeYangon, formatMmk } from '@/lib/utils'

/**
 * One transfer awaiting a decision.
 *
 * THE AMOUNT IS THE LARGEST THING ON THE CARD, beside the screenshot, because
 * the job is comparing two numbers: what the parcel was worth and what the
 * receipt says. The commonest bad receipt is not a forgery — it is a real
 * transfer for 4,850 instead of 48,500.
 *
 * Confirm is one tap. Reject demands a reason, because the parcel stays
 * delivered and somebody in the office has to chase the difference; "rejected"
 * with no note is a debt nobody can act on.
 */
export function KpayCard({ item }: { item: KpayPending }) {
  const router = useRouter()
  const [rejecting, setRejecting] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState<'confirm' | 'reject' | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const run = async (which: 'confirm' | 'reject') => {
    setBusy(which)
    setError(null)
    const result =
      which === 'confirm' ? await confirmKpay(item.id) : await rejectKpay(item.id, reason)
    setBusy(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setRejecting(false)
    router.refresh()
  }

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          {/* The evidence, big enough to read a figure off. */}
          <div className="shrink-0">
            {item.receiptUrl ? (
              <a href={item.receiptUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.receiptUrl}
                  alt={`KBZPay receipt for ${item.code}`}
                  className="h-48 w-40 rounded-lg border object-cover"
                />
              </a>
            ) : (
              <div className="flex h-48 w-40 items-center justify-center rounded-lg border border-dashed text-center text-xs text-muted-foreground">
                No receipt on file
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link
                href={`/admin/orders/${item.id}`}
                className="font-mono text-sm font-semibold text-primary hover:underline"
              >
                {item.code} <ExternalLink className="inline size-3.5" />
              </Link>
              <span className="text-2xl font-bold tabular-nums">
                {formatMmk(item.codAmount)}
              </span>
            </div>

            <p className="text-sm">{item.customerName}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Store className="size-3.5" aria-hidden="true" />
                {item.shopName ?? '—'}
              </span>
              <span className="flex items-center gap-1">
                <Bike className="size-3.5" aria-hidden="true" />
                {item.riderName ?? '—'}
              </span>
              <span>{formatDateTimeYangon(item.deliveredAt)}</span>
            </div>

            {item.proofUrl ? (
              <a
                href={item.proofUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Delivery photo <ExternalLink className="size-3" />
              </a>
            ) : null}

            {error ? <Alert tone="error">{error}</Alert> : null}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => void run('confirm')}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Check />
                {busy === 'confirm' ? 'Confirming…' : 'Confirm KPay payment'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => {
                  setReason('')
                  setError(null)
                  setRejecting(true)
                }}
              >
                <X />
                Reject
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Overlay
        open={rejecting}
        onClose={() => setRejecting(false)}
        side="center"
        title="Reject this receipt?"
        description={`${item.code} · ${formatMmk(item.codAmount)}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(false)} disabled={busy !== null}>
              Go back
            </Button>
            <Button
              variant="destructive"
              onClick={() => void run('reject')}
              disabled={busy !== null || reason.trim().length < 4}
            >
              {busy === 'reject' ? 'Saving…' : 'Reject'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The parcel stays <strong>delivered</strong> — the customer has the goods. The{' '}
            {formatMmk(item.codAmount)} becomes outstanding for the office to chase.
          </p>
          <div className="space-y-1.5">
            <label htmlFor={`reason-${item.id}`} className="text-sm font-medium">
              What was wrong with it?
            </label>
            <Textarea
              id={`reason-${item.id}`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Screenshot shows 4,850 not 48,500"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Saved to the parcel&rsquo;s contact log so whoever chases it knows why.
            </p>
          </div>
          {error ? <Alert tone="error">{error}</Alert> : null}
        </div>
      </Overlay>
    </>
  )
}
