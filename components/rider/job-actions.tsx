'use client'

import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, CloudOff, PackageCheck, TriangleAlert, Truck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ProofCapture } from '@/components/rider/proof-capture'
import { advanceOrder } from '@/lib/rider/actions'
import { enqueue } from '@/lib/rider/offline-queue'
import { explainRiderError } from '@/lib/rider/errors'
import { proofObjectPath, type PreparedImage } from '@/lib/rider/image'
import { createClient } from '@/lib/supabase/client'
import type { OrderStatus } from '@/types/domain'

type Feedback = { tone: 'success' | 'error' | 'info'; message: string } | null

export type JobActionsProps = {
  orderId: string
  orderCode: string
  status: OrderStatus
  /** A return leg goes back to the shop and ends at `returned`, not `delivered`. */
  leg?: 'delivery' | 'pickup' | 'return' | null
  customerName: string
  /** Current GPS fix, stamped onto the checkpoint. */
  position: { lat: number; lng: number } | null
}

/**
 * The rider's state engine: Mark Picked Up -> Mark Delivered.
 *
 * Accept/Decline left with the offer engine (0009). A parcel arrives already
 * assigned — loaded onto the rider's run at the hub — so there is nothing to
 * accept.
 *
 * Every button follows the same discipline:
 *   1. Try the network.
 *   2. On a network-class failure, write the action (photo included) to
 *      IndexedDB and tell the rider it is saved.
 *   3. On a logical failure, say what actually happened and do NOT queue —
 *      queueing "another rider took it" would retry a doomed action forever.
 *
 * `Delivered` is gated on a photo in three independent places: this button is
 * disabled, `advance_order` raises `proof_required`, and the
 * `orders_delivered_needs_proof` CHECK constraint refuses the row. The UI gate is
 * the courtesy; the constraint is the guarantee.
 */
export function JobActions({
  orderId,
  orderCode,
  status,
  leg,
  customerName,
  position,
}: JobActionsProps) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [proof, setProof] = useState<PreparedImage | null>(null)
  const [receiver, setReceiver] = useState('')
  const [failing, setFailing] = useState(false)
  const [failReason, setFailReason] = useState('')
  const [, startTransition] = useTransition()

  const done = useCallback(
    (message: string, tone: 'success' | 'info' = 'success') => {
      setFeedback({ tone, message })
      setBusy(null)
      startTransition(() => router.refresh())
    },
    [router],
  )

  /** Shared failure handling: queue network failures, surface logical ones. */
  const handleFailure = useCallback(
    async (
      rawMessage: string,
      queueAs: Parameters<typeof enqueue>[0] | null,
    ) => {
      const explained = explainRiderError(rawMessage)
      if (explained.kind === 'network' && queueAs) {
        await enqueue(queueAs)
        setFeedback({
          tone: 'info',
          message: 'No signal — saved on your phone. It will send when you reconnect.',
        })
      } else {
        setFeedback({ tone: 'error', message: explained.message })
      }
      setBusy(null)
      startTransition(() => router.refresh())
    },
    [router],
  )

  /**
   * Hand a returned parcel back to the shop.
   *
   * A NAME, not a photo. The dispute a return invites is "you never brought it
   * back", which a name and a timestamp answer; `advance_order` and the
   * `orders_returned_needs_receiver` CHECK both refuse without one.
   */
  const onReturned = async () => {
    if (!receiver.trim()) {
      setFeedback({ tone: 'error', message: 'Write who at the shop took it back.' })
      return
    }
    setBusy('returned')
    setFeedback(null)
    try {
      const result = await advanceOrder({
        orderId,
        to: 'returned',
        lat: position?.lat,
        lng: position?.lng,
        receiver: receiver.trim(),
      })
      if (result.ok) return done(result.message)
      await handleFailure(`${result.message} ${result.kind}`, {
        kind: 'failed',
        orderId,
        orderCode,
        receiver: receiver.trim(),
      })
    } catch (error) {
      await handleFailure(error instanceof Error ? error.message : 'network', {
        kind: 'failed',
        orderId,
        orderCode,
        receiver: receiver.trim(),
      })
    }
  }

  const onPickedUp = async () => {
    setBusy('picked_up')
    setFeedback(null)
    try {
      const result = await advanceOrder({
        orderId,
        to: 'picked_up',
        lat: position?.lat,
        lng: position?.lng,
      })
      if (result.ok) return done(result.message)
      await handleFailure(`${result.message} ${result.kind}`, {
        kind: 'picked_up',
        orderId,
        orderCode,
        lat: position?.lat,
        lng: position?.lng,
      })
    } catch (error) {
      await handleFailure(error instanceof Error ? error.message : 'network', {
        kind: 'picked_up',
        orderId,
        orderCode,
        lat: position?.lat,
        lng: position?.lng,
      })
    }
  }

  const onDelivered = async () => {
    if (!proof) {
      setFeedback({ tone: 'error', message: 'Take a photo of the delivery first.' })
      return
    }
    setBusy('delivered')
    setFeedback(null)

    // Photo first: the storage policy only allows writes while the order is
    // still assigned/picked_up, so uploading after the transition would fail.
    const path = proofObjectPath(orderId, proof.extension)
    try {
      const { error: uploadError } = await supabase.storage
        .from('delivery-proofs')
        .upload(path, proof.blob, { contentType: proof.contentType, upsert: false })
      if (uploadError) throw new Error(uploadError.message)

      const result = await advanceOrder({
        orderId,
        to: 'delivered',
        lat: position?.lat,
        lng: position?.lng,
        proofPath: path,
        receiver: receiver.trim() || customerName,
      })
      if (result.ok) return done(result.message)
      await handleFailure(`${result.message} ${result.kind}`, queuedDelivery())
    } catch (error) {
      await handleFailure(error instanceof Error ? error.message : 'network', queuedDelivery())
    }

    function queuedDelivery(): Parameters<typeof enqueue>[0] {
      // The Blob rides into IndexedDB so the proof survives the app being killed.
      return {
        kind: 'delivered',
        orderId,
        orderCode,
        lat: position?.lat,
        lng: position?.lng,
        receiver: receiver.trim() || customerName,
        proof: proof!.blob,
        proofContentType: proof!.contentType,
      }
    }
  }

  const onFailed = async () => {
    if (!failReason.trim()) {
      setFeedback({ tone: 'error', message: 'Say what went wrong.' })
      return
    }
    setBusy('failed')
    try {
      const result = await advanceOrder({
        orderId,
        to: 'failed',
        lat: position?.lat,
        lng: position?.lng,
        reason: failReason.trim(),
      })
      if (result.ok) {
        setFailing(false)
        return done(result.message, 'info')
      }
      await handleFailure(`${result.message} ${result.kind}`, {
        kind: 'failed',
        orderId,
        orderCode,
        reason: failReason.trim(),
        lat: position?.lat,
        lng: position?.lng,
      })
    } catch (error) {
      await handleFailure(error instanceof Error ? error.message : 'network', {
        kind: 'failed',
        orderId,
        orderCode,
        reason: failReason.trim(),
        lat: position?.lat,
        lng: position?.lng,
      })
    }
  }

  return (
    <div className="space-y-3">
      {feedback ? (
        <Alert tone={feedback.tone === 'success' ? 'success' : feedback.tone === 'info' ? 'info' : 'error'}>
          {feedback.tone === 'info' ? (
            <span className="flex items-center gap-1.5">
              <CloudOff className="size-3.5" />
              {feedback.message}
            </span>
          ) : (
            feedback.message
          )}
        </Alert>
      ) : null}

      {/* A return leg never reaches `delivered`: it is handed back to the shop
          and ends at `returned`. Showing the proof-photo flow here would ask a
          rider to photograph a shop counter for a parcel nobody paid for. */}
      {leg === 'return' && (status === 'assigned' || status === 'picked_up') ? (
        <div className="space-y-3 rounded-lg border bg-card p-3">
          <p className="text-sm font-medium">Returning to {customerName}</p>
          <Input
            value={receiver}
            onChange={(e) => setReceiver(e.target.value)}
            placeholder="Who took it back?"
            aria-label="Who at the shop took the parcel back"
          />
          <Button size="touch" block disabled={busy !== null} onClick={() => void onReturned()}>
            <PackageCheck />
            {busy === 'returned' ? 'Saving…' : 'Returned to shop'}
          </Button>
        </div>
      ) : null}

      {leg !== 'return' && status === 'assigned' ? (
        <Button size="touch" block disabled={busy !== null} onClick={() => void onPickedUp()}>
          <Truck />
          {busy === 'picked_up' ? 'Saving…' : 'Mark picked up'}
        </Button>
      ) : null}

      {leg !== 'return' && status === 'picked_up' ? (
        <div className="space-y-3 rounded-lg border bg-card p-3">
          <p className="text-sm font-medium">Proof of delivery</p>
          <ProofCapture onReady={setProof} disabled={busy !== null} />

          <div className="space-y-1.5">
            <label htmlFor="receiver" className="text-xs font-medium text-muted-foreground">
              Who received it? (optional)
            </label>
            <Input
              id="receiver"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              placeholder={customerName}
              disabled={busy !== null}
            />
          </div>

          <Button
            size="touch"
            block
            disabled={busy !== null || !proof}
            onClick={() => void onDelivered()}
          >
            <PackageCheck />
            {busy === 'delivered' ? 'Saving…' : 'Mark delivered'}
          </Button>
          {!proof ? (
            <p className="text-center text-xs text-muted-foreground">
              A photo is required before this can be marked delivered.
            </p>
          ) : null}
        </div>
      ) : null}

      {status === 'assigned' || status === 'picked_up' ? (
        failing ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900">What went wrong?</p>
            <Textarea
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              rows={2}
              placeholder="Customer not home, wrong address, phone off…"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={busy !== null}
                onClick={() => void onFailed()}
              >
                {busy === 'failed' ? 'Saving…' : 'Confirm failed'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFailing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" block onClick={() => setFailing(true)}>
            <TriangleAlert />
            Cannot complete this delivery
          </Button>
        )
      ) : null}
    </div>
  )
}
