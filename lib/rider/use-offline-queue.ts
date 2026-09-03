'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { advanceOrder } from '@/lib/rider/actions'
import {
  backoffMs,
  classifyFailure,
  listQueue,
  onQueueChange,
  removeAction,
  updateAction,
  type QueuedAction,
} from '@/lib/rider/offline-queue'

/**
 * Drains the offline queue.
 *
 * Flush triggers: mount, the browser's `online` event, a queue change, and a
 * slow poll. The poll exists because `navigator.onLine` lies constantly on
 * mobile — it reports true on a captive portal or a connected-but-dead cell, so
 * an event-only flusher can sit on a full queue indefinitely.
 *
 * A queued `delivered` carries its photo as a Blob. Flushing therefore uploads
 * the proof FIRST and only then calls `advance_order`, because the storage policy
 * permits writes only while the order is still assigned/picked_up.
 */
export function useOfflineQueue() {
  const supabase = useRef(createClient()).current
  const [queue, setQueue] = useState<QueuedAction[]>([])
  const [flushing, setFlushing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const flushingRef = useRef(false)

  const reload = useCallback(async () => {
    try {
      setQueue(await listQueue())
    } catch {
      setQueue([])
    }
  }, [])

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    flushingRef.current = true
    setFlushing(true)

    try {
      const items = await listQueue()
      for (const item of items) {
        // Respect backoff without blocking the whole queue on one bad item.
        if (item.attempts > 0 && Date.now() - item.createdAt < backoffMs(item.attempts - 1)) {
          continue
        }

        try {
          let proofPath: string | undefined

          if (item.kind === 'delivered' && item.proof) {
            const path = `${item.orderId}/${item.id}.${
              item.proofContentType === 'image/jpeg' ? 'jpg' : 'webp'
            }`
            const { error: uploadError } = await supabase.storage
              .from('delivery-proofs')
              .upload(path, item.proof, {
                contentType: item.proofContentType ?? 'image/webp',
                upsert: true, // same action id -> same path, so a retry is safe
              })
            if (uploadError) throw new Error(uploadError.message)
            proofPath = path
          }

          // The KBZPay receipt rides along the same way, under its own key so a
          // retry lands on the same object.
          let kpayProofPath: string | undefined
          if (item.kind === 'delivered' && item.kpayProof) {
            const path = `${item.orderId}/kpay-${item.id}.${
              item.kpayProofContentType === 'image/jpeg' ? 'jpg' : 'webp'
            }`
            const { error: kpayError } = await supabase.storage
              .from('delivery-proofs')
              .upload(path, item.kpayProof, {
                contentType: item.kpayProofContentType ?? 'image/webp',
                upsert: true,
              })
            if (kpayError) throw new Error(kpayError.message)
            kpayProofPath = path
          }

          const result =
             await advanceOrder({
                  orderId: item.orderId,
                  to: item.kind,
                  lat: item.lat,
                  lng: item.lng,
                  proofPath,
                  receiver: item.receiver,
                  reason: item.reason,
                  collectedVia: item.collectedVia,
                  kpayProofPath,
                })

          if (result.ok) {
            await removeAction(item.id)
            continue
          }
          throw new Error(result.message + ' ' + result.kind)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const outcome = classifyFailure(message, item.attempts)

          if (outcome === 'done' || outcome === 'superseded') {
            await removeAction(item.id)
          } else if (outcome === 'dead') {
            await removeAction(item.id)
            setLastError(message)
          } else {
            await updateAction({ ...item, attempts: item.attempts + 1, lastError: message })
            // Stop the sweep: if one item failed on the network, the rest will too.
            break
          }
        }
      }
    } finally {
      flushingRef.current = false
      setFlushing(false)
      await reload()
    }
  }, [supabase, reload])

  useEffect(() => {
    void reload()
    const unsubscribe = onQueueChange(() => void reload())
    return unsubscribe
  }, [reload])

  useEffect(() => {
    void flush()
    const onOnline = () => void flush()
    window.addEventListener('online', onOnline)
    // navigator.onLine is unreliable on mobile — poll as well.
    const id = setInterval(() => void flush(), 15_000)
    return () => {
      window.removeEventListener('online', onOnline)
      clearInterval(id)
    }
  }, [flush])

  return { queue, flushing, lastError, flush, reload, clearError: () => setLastError(null) } as const
}
