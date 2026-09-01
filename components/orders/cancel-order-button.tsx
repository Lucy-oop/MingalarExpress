'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { cancelOrder } from '@/lib/orders/actions'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'

/**
 * Cancel a parcel that has not been picked up yet.
 *
 * `cancelOrder` and the RLS policy behind it (`orders_update_shop`, which allows
 * `pending -> cancelled` for the owning shop) have both existed since Phase 2
 * with nothing calling them — a shop that made a mistake had to telephone the
 * office. This is the button.
 *
 * A dialog rather than a `window.confirm` because the reason is worth recording:
 * it is written to `orders.cancel_reason` and shown back on this page, so a
 * shop reading their own history later can tell a customer's cancellation from
 * a duplicate entry.
 *
 * The server re-checks the status (`.eq('status', 'pending')`), so a parcel a
 * rider picked up while this dialog was open cannot be cancelled from here.
 */
export function CancelOrderButton({
  orderId,
  orderCode,
}: {
  orderId: string
  orderCode: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const result = await cancelOrder(orderId, reason.trim())
    setBusy(false)

    if (result && 'error' in result && result.error) {
      setError(result.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setReason('')
          setError(null)
          setOpen(true)
        }}
      >
        <X />
        Cancel order
      </Button>

      <Overlay
        open={open}
        onClose={() => setOpen(false)}
        side="center"
        title="Cancel this order?"
        description={`${orderCode} will stop being dispatched. This cannot be undone.`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Cancelling…' : 'Cancel order'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="cancel-reason" className="text-sm font-medium">
              Why? <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id="cancel-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer changed their mind"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Saved with the order so you can tell later why it was stopped.
            </p>
          </div>
          {error ? <Alert tone="error">{error}</Alert> : null}
        </div>
      </Overlay>
    </>
  )
}
