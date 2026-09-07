'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertRole } from '@/lib/auth/guards'
import { explainRiderError } from '@/lib/rider/errors'
import type { OrderStatus } from '@/types/domain'

/**
 * Rider write actions.
 *
 * Every one is a thin, typed wrapper over an RPC that does the real enforcement:
 *   advance_order     -> validates the transition and refuses `delivered`
 *                        without a proof photo
 *   rider_heartbeat   -> presence + position, rider-scoped
 *
 * The client never trusts these to succeed. Every call site queues the action
 * offline first (lib/rider/offline-queue) so a dead zone cannot lose a delivery.
 */

export type RiderActionResult =
  | { ok: true; message: string; status?: OrderStatus }
  | { ok: false; message: string; kind: string; retryable: boolean }

async function riderClient() {
  const ctx = await assertRole('rider')
  const supabase = await createClient()
  return { ctx, supabase }
}

function refresh(orderId?: string) {
  revalidatePath('/rider/dashboard')
  revalidatePath('/rider/earnings')
  if (orderId) revalidatePath(`/rider/jobs/${orderId}`)
}

export async function setRiderOnline(
  online: boolean,
  lat?: number,
  lng?: number,
): Promise<RiderActionResult> {
  try {
    const { supabase } = await riderClient()
    const { error } = await supabase.rpc('rider_heartbeat', {
      p_online: online,
      p_lat: lat,
      p_lng: lng,
    })
    if (error) {
      const e = explainRiderError(error.message)
      return { ok: false, message: e.message, kind: e.kind, retryable: e.retryable }
    }
    revalidatePath('/rider/dashboard')
    return { ok: true, message: online ? 'You are online.' : 'You are offline.' }
  } catch {
    return { ok: false, message: 'Sign in again to change your status.', kind: 'forbidden', retryable: false }
  }
}

/**
 * Advance an order the rider is carrying.
 *
 * `proofPath` is the storage object key of an ALREADY-UPLOADED photo. The upload
 * happens client-side and must precede this call, because the storage policy
 * only permits writes while the order is still `assigned` or `picked_up` —
 * uploading after the transition to `delivered` would be rejected.
 */
/**
 * One armful, one call.
 *
 * WHY A BULK RPC AND NOT A LOOP. `advance_orders` (0025) runs every parcel in
 * ONE transaction with a deterministic lock order, so a shop handing over nine
 * of ten either moves all nine or none — a partially-collected armful is the
 * thing a rider cannot see and cannot correct. It also caps at 200 and refuses
 * an empty array.
 *
 * ONLY `picked_up` IS USEFUL HERE. `advance_orders` deliberately passes no
 * proof, receiver or coordinates, so a bulk `delivered` is refused by
 * `advance_order`'s own `proof_required` guard — per-parcel evidence has to be
 * captured per parcel. The type says so rather than leaving it to be discovered.
 *
 * OFFLINE IS N SEPARATE ENTRIES, not one. The caller queues per order, which is
 * what `lib/rider/collection.ts` documents: each parcel then replays
 * independently and idempotently, so one parcel that has moved on cannot
 * discard the other nine. The all-or-nothing guarantee is an online one.
 */
export async function advanceOrders(input: {
  orderIds: string[]
  to: Extract<OrderStatus, 'picked_up'>
  reason?: string
}): Promise<RiderActionResult & { moved?: number }> {
  if (input.orderIds.length === 0) {
    return { ok: false, message: 'Nothing selected.', kind: 'empty', retryable: false }
  }
  try {
    const { supabase } = await riderClient()
    const { data, error } = await supabase.rpc('advance_orders', {
      p_order_ids: input.orderIds,
      p_to: input.to,
      p_reason: input.reason,
    })
    if (error) {
      const e = explainRiderError(error.message)
      return { ok: false, message: e.message, kind: e.kind, retryable: e.retryable }
    }
    refresh()
    const moved = Number(data ?? 0)
    return { ok: true, message: `${moved} parcel${moved === 1 ? '' : 's'} collected.`, moved }
  } catch {
    return {
      ok: false,
      message: 'Sign in again to update these jobs.',
      kind: 'forbidden',
      retryable: false,
    }
  }
}

export async function advanceOrder(input: {
  orderId: string
  to: Extract<OrderStatus, 'picked_up' | 'delivered' | 'failed' | 'returned'>
  lat?: number
  lng?: number
  proofPath?: string
  receiver?: string
  reason?: string
  /** How the customer paid. Omitted means cash — see the note in migration 0021. */
  collectedVia?: 'cash' | 'kpay'
  /** delivery-proofs path for the KBZPay receipt. Required when collectedVia is kpay. */
  kpayProofPath?: string
}): Promise<RiderActionResult> {
  try {
    const { supabase } = await riderClient()
    const { data, error } = await supabase.rpc('advance_order', {
      p_order_id: input.orderId,
      p_to: input.to,
      p_lat: input.lat,
      p_lng: input.lng,
      p_proof: input.proofPath,
      p_receiver: input.receiver,
      p_reason: input.reason,
      p_collected_via: input.collectedVia,
      p_kpay_proof: input.kpayProofPath,
    })
    if (error) {
      const e = explainRiderError(error.message)
      return { ok: false, message: e.message, kind: e.kind, retryable: e.retryable }
    }
    refresh(input.orderId)
    const order = data as unknown as { status?: OrderStatus } | null
    return {
      ok: true,
      message:
        input.to === 'picked_up'
          ? 'Parcel picked up.'
          : input.to === 'delivered'
            ? 'Delivered. Well done.'
            : 'Marked as failed.',
      status: order?.status,
    }
  } catch {
    return { ok: false, message: 'Sign in again to update this job.', kind: 'forbidden', retryable: false }
  }
}
