'use client'

import * as React from 'react'
import { useCallback, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { CheckCircle2, CloudOff, PackageCheck, TriangleAlert, Truck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { ProofCapture } from '@/components/rider/proof-capture'
import { PaymentChoice } from '@/components/rider/payment-choice'
import { advanceOrder } from '@/lib/rider/actions'
import { enqueue } from '@/lib/rider/offline-queue'
import { explainRiderError } from '@/lib/rider/errors'
import { proofObjectPath, type PreparedImage } from '@/lib/rider/image'
import { createClient } from '@/lib/supabase/client'
import type { OrderStatus } from '@/types/domain'
import { useT } from '@/components/shared/i18n-provider'

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
  /** What the rider collects at the door. 0 for a prepaid parcel. */
  codAmount: number
  /** The office's KBZPay account, from app_settings. */
  kpayAccount: { name: string | null; phone: string | null; qrUrl: string }
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
/**
 * The primary action, in a bar the rider's thumb can always reach.
 *
 * A PORTAL, AND IT HAS TO BE. The action belongs at the bottom of the screen;
 * the inputs it depends on -- the delivery photo, the payment choice, a KPay
 * receipt -- belong in the page flow, because they are a sequence needing room
 * and two hands, and a 500px fixed bar would cover the address the rider is
 * reading.
 *
 * Rendering `JobActions` twice would have been the obvious split and is wrong:
 * `proof`, `collectedVia` and `busy` live in one component, and two instances
 * would each hold their own copy. So one instance renders both halves, and this
 * moves the button out of the DOM position it was declared in.
 *
 * `mounted` guards the portal because `document` does not exist during the
 * server render, and this file is a Client Component in a server-rendered page.
 */
function ActionBar({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  // Before hydration, and if the portal ever cannot mount, the buttons render
  // where they were declared rather than vanishing. A rider must never lose the
  // only control that finishes a job.
  if (!mounted) return <>{children}</>

  return createPortal(
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 space-y-2 border-t bg-background px-3 pt-3',
        // The same padding the tab bar used, so it clears the iOS home
        // indicator and the Android gesture bar. `RiderTabs` steps aside on
        // this route, so nothing is stacked underneath.
        'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
      )}
    >
      {children}
    </div>,
    document.body,
  )
}

export function JobActions({
  orderId,
  orderCode,
  status,
  leg,
  customerName,
  position,
  codAmount,
  kpayAccount,
}: JobActionsProps) {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [proof, setProof] = useState<PreparedImage | null>(null)
  /**
   * Cash or KBZPay, and the receipt when it is KBZPay.
   *
   * `collectedVia` starts NULL rather than 'cash'. A pre-selected default is a
   * button a tired rider taps past, and getting this wrong books cash against
   * someone who took none — so the choice has to be made, not accepted.
   */
  const [collectedVia, setCollectedVia] = useState<'cash' | 'kpay' | null>(null)
  const [kpayProof, setKpayProof] = useState<PreparedImage | null>(null)
  const [receiver, setReceiver] = useState('')
  const [failing, setFailing] = useState(false)
  const [failReason, setFailReason] = useState('')
  const [, startTransition] = useTransition()

  /**
   * Latched once an action has landed — on the server OR in the offline queue.
   *
   * `busy` alone is not enough. It clears the moment the call returns, but the
   * screen only changes shape when `router.refresh()` brings the new status
   * back, and on Yangon mobile data that can be seconds. In that window the
   * button was live again on a job that was already done: a second tap either
   * uploaded a second photo and failed with `illegal_transition` — an alarming
   * error on a delivery that actually succeeded — or, with no signal, wrote a
   * SECOND copy of the same action into IndexedDB.
   *
   * It is never reset. Every path that sets it either changes the parcel's
   * status (so this block unmounts) or has banked the action for replay.
   */
  const [completed, setCompleted] = useState(false)

  const done = useCallback(
    (message: string, tone: 'success' | 'info' = 'success') => {
      setFeedback({ tone, message })
      setBusy(null)
      setCompleted(true)
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
        // Banked for replay, so it must not be tappable again — see `completed`.
        setCompleted(true)
        setFeedback({
          tone: 'info',
          message: t('offline.saved'),
        })
        setBusy(null)
        startTransition(() => router.refresh())
        // Told to the caller so a panel that is finished with can close itself.
        // The fail panel used to stay open after an offline save, leaving a red
        // button reading "Saved" beside a live "Back", over the box the rider
        // had just filled in.
        return true
      } else {
        // A logical failure is genuinely retryable after the rider fixes
        // something, so `completed` stays false here on purpose.
        setFeedback({ tone: 'error', message: explained.message })
      }
      setBusy(null)
      startTransition(() => router.refresh())
      return false
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
      setFeedback({ tone: 'error', message: t('proof.returnReceiverRequired') })
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
        // Only on a collection, and only if they typed one. On a delivery leg
        // this field is the customer's receiver and is asked for later.
        receiver: collecting ? receiver.trim() || undefined : undefined,
      })
      if (result.ok) return done(result.message)
      await handleFailure(`${result.message} ${result.kind}`, {
        kind: 'picked_up',
        orderId,
        orderCode,
        receiver: collecting ? receiver.trim() || undefined : undefined,
        lat: position?.lat,
        lng: position?.lng,
      })
    } catch (error) {
      await handleFailure(error instanceof Error ? error.message : 'network', {
        kind: 'picked_up',
        orderId,
        orderCode,
        receiver: collecting ? receiver.trim() || undefined : undefined,
        lat: position?.lat,
        lng: position?.lng,
      })
    }
  }

  /*
    0029: THE LEG DECIDES THE SCREEN, and it used to decide almost nothing.
    Every branch below asked `leg !== 'return'`, so a collection inherited the
    whole door-step flow: a proof photo it cannot produce, "How did the customer
    pay?" for a customer who is not there, and DONE - DELIVERED as the primary
    button. `advance_order` now refuses that tap outright; this is the half that
    stops offering it.
  */
  const collecting = leg === 'pickup'
  // No customer at a shop counter, so nothing to pay and nobody to pay it.
  const needsPayment = codAmount > 0 && !collecting
  const onDelivered = async () => {
    if (!proof) {
      setFeedback({ tone: 'error', message: t('fail.photoFirst') })
      return
    }
    if (needsPayment && collectedVia === null) {
      setFeedback({ tone: 'error', message: t('pay.chooseFirst') })
      return
    }
    if (collectedVia === 'kpay' && !kpayProof) {
      setFeedback({ tone: 'error', message: t('pay.receiptRequired') })
      return
    }
    setBusy('delivered')
    setFeedback(null)

    // Photos first: the storage policy only allows writes while the order is
    // still assigned/picked_up, so uploading after the transition would fail.
    const path = proofObjectPath(orderId, proof.extension)
    const kpayPath = kpayProof ? proofObjectPath(orderId, kpayProof.extension) : undefined
    try {
      const { error: uploadError } = await supabase.storage
        .from('delivery-proofs')
        .upload(path, proof.blob, { contentType: proof.contentType, upsert: false })
      if (uploadError) throw new Error(uploadError.message)

      if (kpayProof && kpayPath) {
        const { error: kpayError } = await supabase.storage
          .from('delivery-proofs')
          .upload(kpayPath, kpayProof.blob, {
            contentType: kpayProof.contentType,
            upsert: false,
          })
        if (kpayError) throw new Error(kpayError.message)
      }

      const result = await advanceOrder({
        orderId,
        to: 'delivered',
        lat: position?.lat,
        lng: position?.lng,
        proofPath: path,
        receiver: receiver.trim() || customerName,
        collectedVia: collectedVia ?? undefined,
        kpayProofPath: kpayPath,
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
        // Queued with the parcel: a KPay delivery replayed as cash would put
        // the money back on the rider.
        collectedVia: collectedVia ?? undefined,
        kpayProof: kpayProof?.blob,
        kpayProofContentType: kpayProof?.contentType,
      }
    }
  }

  const onFailed = async () => {
    if (!failReason.trim()) {
      setFeedback({ tone: 'error', message: t('fail.required') })
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
      const queued = await handleFailure(`${result.message} ${result.kind}`, {
        kind: 'failed',
        orderId,
        orderCode,
        reason: failReason.trim(),
        lat: position?.lat,
        lng: position?.lng,
      })
      if (queued) setFailing(false)
    } catch (error) {
      const queued = await handleFailure(error instanceof Error ? error.message : 'network', {
        kind: 'failed',
        orderId,
        orderCode,
        reason: failReason.trim(),
        lat: position?.lat,
        lng: position?.lng,
      })
      if (queued) setFailing(false)
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
          <p className="text-base font-semibold">{t('parcel.returnTo')} · {customerName}</p>
          <Input
            value={receiver}
            onChange={(e) => setReceiver(e.target.value)}
            placeholder={t('proof.returnReceiver')}
            aria-label={t('proof.returnReceiver')}
            className="h-14 text-base"
          />
          <ActionBar>
          <Button
            size="touch"
            block
            disabled={busy !== null || completed}
            onClick={() => void onReturned()}
          >
            <PackageCheck />
            {busy === 'returned'
              ? t('action.saving')
              : completed
                ? t('action.saved')
                : t('action.markReturned')}
          </Button>
          </ActionBar>
        </div>
      ) : null}

      {leg !== 'return' && status === 'assigned' ? (
        <div className="space-y-3">
          {/* Optional, and only on a collection: the shop's own name for
              whoever handed the parcels over. Never required — a rider holding
              ten parcels at a counter should not be blocked by a text field. */}
          {collecting ? (
            <div className="space-y-1.5">
              <label htmlFor="shopContact" className="text-sm font-medium">
                {t('proof.shopContact')}{' '}
                <span className="font-normal text-muted-foreground">
                  ({t('proof.receiverOptional')})
                </span>
              </label>
              <Input
                id="shopContact"
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
                disabled={busy !== null}
                className="h-14 text-base"
              />
            </div>
          ) : null}

          <ActionBar>
          <Button
            size="touch"
            block
            className="bg-emerald-600 text-lg font-bold hover:bg-emerald-700"
            disabled={busy !== null || completed}
            onClick={() => void onPickedUp()}
          >
            <Truck />
            {busy === 'picked_up'
              ? t('action.saving')
              : completed
                ? t('action.saved')
                : collecting
                  ? t('action.markCollected')
                  : t('action.markPickedUp')}
          </Button>
          </ActionBar>
        </div>
      ) : null}

      {/* Aboard, between the shop and the hub. There is no action here: the
          parcel is on the bike and close_trip releases it when the run ends.
          This slot used to hold the entire delivery card. */}
      {collecting && status === 'picked_up' ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <PackageCheck className="size-5 shrink-0 text-emerald-700" aria-hidden="true" />
          <p className="text-base font-medium">{t('pickup.aboard')}</p>
        </div>
      ) : null}

      {!collecting && leg !== 'return' && status === 'picked_up' ? (
        <div className="space-y-3 rounded-lg border bg-card p-3">
          <p className="text-base font-semibold">{t('proof.title')}</p>
          <ProofCapture onReady={setProof} disabled={busy !== null || completed} />

          {/* Only for a parcel with money on it. A prepaid delivery has nothing
              to choose and the question would be noise. */}
          {needsPayment ? (
            <div className="border-t pt-3">
              <PaymentChoice
                value={collectedVia}
                onChange={(via) => {
                  setCollectedVia(via)
                  setFeedback(null)
                  if (via === 'cash') setKpayProof(null)
                }}
                amount={codAmount}
                account={kpayAccount}
                disabled={busy !== null || completed}
              />
            </div>
          ) : null}

          {collectedVia === 'kpay' ? (
            <div className="space-y-2 border-t pt-3">
              <p className="text-base font-semibold">{t('pay.receiptTitle')}</p>
              <ProofCapture
                onReady={setKpayProof}
                disabled={busy !== null || completed}
                label={t('pay.takeReceipt')}
              />
              <p className="text-sm text-muted-foreground">{t('pay.receiptHint')}</p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="receiver" className="text-sm font-medium">
              {t('proof.receiver')}{' '}
              <span className="font-normal text-muted-foreground">
                ({t('proof.receiverOptional')})
              </span>
            </label>
            <Input
              id="receiver"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              placeholder={customerName}
              disabled={busy !== null}
              className="h-14 text-base"
            />
          </div>

          <ActionBar>
          <Button
            size="touch"
            block
            className="bg-emerald-600 text-lg font-bold hover:bg-emerald-700"
            disabled={
              busy !== null ||
              !proof ||
              completed ||
              (needsPayment && collectedVia === null) ||
              (collectedVia === 'kpay' && !kpayProof)
            }
            onClick={() => void onDelivered()}
          >
            <PackageCheck />
            {busy === 'delivered'
              ? t('action.saving')
              : completed
                ? t('action.saved')
                : t('action.markDelivered')}
          </Button>
          </ActionBar>
          {!proof && !completed ? (
            <p className="text-center text-sm font-medium text-muted-foreground">
              {t('proof.required')}
            </p>
          ) : null}
        </div>
      ) : null}

      {status === 'assigned' || status === 'picked_up' ? (
        failing ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-base font-semibold text-amber-900">{t('fail.title')}</p>
            <Textarea
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              rows={2}
              // "Customer not home, phone off, wrong address" is nonsense at a
              // shop counter, which is now half of a rider's stops.
              placeholder={collecting ? t('fail.pickupPlaceholder') : t('fail.placeholder')}
              className="text-base"
            />
            {/*
              STACKED, not side by side. This was `flex gap-2` with the confirm
              button at flex-1 and Back at its intrinsic width, so a wide red bar
              sat beside a narrow ghost, both 56px tall, directly under the
              textarea — two competing targets for one thumb, with no hierarchy
              between them. Full width and in order of consequence instead.
            */}
            <div className="space-y-2">
              <Button
                size="touch"
                variant="destructive"
                block
                className="font-bold"
                disabled={busy !== null || completed}
                onClick={() => void onFailed()}
              >
                {busy === 'failed'
                  ? t('action.saving')
                  : completed
                    ? t('action.saved')
                    : t('action.confirmFailed')}
              </Button>
              <Button
                size="touch"
                variant="ghost"
                block
                disabled={busy !== null}
                onClick={() => setFailing(false)}
              >
                {t('action.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <ActionBar>
            <Button variant="ghost" size="touch" block onClick={() => setFailing(true)}>
              <TriangleAlert />
              {t('action.cannotDeliver')}
            </Button>
          </ActionBar>
        )
      ) : null}
    </div>
  )
}
