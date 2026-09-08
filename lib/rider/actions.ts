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
 * `picked_up` OR `failed`, AND NOTHING ELSE. `advance_orders` deliberately
 * passes no proof, receiver or coordinates, so a bulk `delivered` is refused by
 * `advance_order`'s own `proof_required` guard — per-parcel evidence has to be
 * captured per parcel. The type says so rather than leaving it to be discovered.
 * `failed` carries a reason, which is the one per-parcel field a whole armful
 * can honestly share: they were all at the same counter.
 *
 * OFFLINE IS N SEPARATE ENTRIES, not one. The caller queues per order, which is
 * what `lib/rider/collection.ts` documents: each parcel then replays
 * independently and idempotently, so one parcel that has moved on cannot
 * discard the other nine. The all-or-nothing guarantee is an online one.
 */
export async function advanceOrders(
  input:
    | { orderIds: string[]; to: 'picked_up'; reason?: string }
    /*
      REPORTING A SHOP THAT WAS SHORT. `assigned -> failed` is not a delivery
      failure — 0018 counts it separately, against max_collection_attempts, as
      an UNCOLLECTED attempt. So a shop that is not ready every morning stops
      being invisible and starts hitting a ceiling the office works.

      The reason is required by the type because `advance_order` raises
      `fail_reason_required` without one, and a bulk call that fails on the
      first parcel has already rolled the rest back.
    */
    | { orderIds: string[]; to: 'failed'; reason: string },
): Promise<RiderActionResult & { moved?: number }> {
  if (input.orderIds.length === 0) {
    return { ok: false, message: 'Nothing selected.', kind: 'empty', retryable: false }
  }
  if (input.to === 'failed' && !input.reason.trim()) {
    return {
      ok: false,
      message: 'Say what happened.',
      kind: 'fail_reason_required',
      retryable: false,
    }
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
    const noun = moved === 1 ? 'parcel' : 'parcels'
    return {
      ok: true,
      message:
        input.to === 'failed'
          ? `${moved} ${noun} reported as not collected.`
          : `${moved} ${noun} collected.`,
      moved,
    }
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

/**
 * A rider's note about a collection, filed against every parcel in it.
 *
 * BESIDE THE REPORT FLOW, NOT INSTEAD OF IT, and the division is the point:
 *
 *   Report as not collected   a MISSING parcel. Goes through
 *                             `assigned -> failed` with a reason, lands as an
 *                             uncollected attempt, and counts against
 *                             `max_collection_attempts` — which is what makes a
 *                             chronically-short shop visible to the office.
 *   This                      everything else. "Shutter closed early." "New
 *                             staff." "Shop says the rest come tomorrow."
 *                             Nothing about the parcel's state changes.
 *
 * A free-text note could never do the first job: it attaches to the parcels
 * that DID arrive and never reaches the attempt counter. So both exist.
 *
 * ONE ROW PER PARCEL, same body. A note filed against "the collection" would
 * have nowhere to live — a collection is a grouping the app invents from a
 * shared pickup address, not a row — and the office looks at parcels.
 *
 * `kind = 'note'` because the CHECK allows only note/contact/decision, and
 * `author_role` already records that a rider wrote it (0038). Write-only: the
 * policy lets a rider add a note to a parcel they are carrying and does not let
 * them read the log back, which holds what the office promised a customer.
 *
 * NOT QUEUED OFFLINE, unlike a checkpoint. Losing a note costs a sentence;
 * losing a `picked_up` costs a parcel's state, which is why that one has a
 * queue and this one reports its failure and stops.
 */
export async function saveCollectionNote(input: {
  orderIds: string[]
  body: string
}): Promise<RiderActionResult> {
  const body = input.body.trim()
  // Mirrors `order_notes_body_check` so the rider gets a sentence rather than a
  // constraint violation.
  if (body.length < 1) {
    return { ok: false, message: 'Write something first.', kind: 'invalid', retryable: false }
  }
  if (body.length > 2000) {
    return { ok: false, message: 'That note is too long.', kind: 'invalid', retryable: false }
  }
  if (input.orderIds.length === 0) {
    return { ok: false, message: 'Nothing to note.', kind: 'invalid', retryable: false }
  }

  try {
    const { ctx, supabase } = await riderClient()

    const { error } = await supabase.from('order_notes').insert(
      input.orderIds.map((orderId) => ({
        order_id: orderId,
        author_id: ctx.userId,
        author_role: 'rider' as const,
        kind: 'note' as const,
        body,
      })),
    )

    if (error) {
      return {
        ok: false,
        // RLS refuses a parcel that is not theirs; anything else is a network
        // or server problem worth retrying.
        message: /row-level security|42501/.test(error.message)
          ? 'That parcel is not on your run any more.'
          : 'Could not save the note. Try again.',
        kind: 'note_failed',
        retryable: !/row-level security|42501/.test(error.message),
      }
    }

    refresh()
    return { ok: true, message: 'Note saved.' }
  } catch {
    return { ok: false, message: 'Sign in again to add a note.', kind: 'forbidden', retryable: false }
  }
}
