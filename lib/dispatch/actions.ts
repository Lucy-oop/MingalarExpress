'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertRole } from '@/lib/auth/guards'
import { explainDispatchError } from '@/lib/dispatch/errors'
import type { OrderStatus } from '@/types/domain'

/**
 * Dispatcher write actions for the PER-PARCEL path.
 *
 * What is left after 0009 retired the offer engine: Route Local ad-hoc drops,
 * reassigning a failed parcel, and cancelling. Route runs go through
 * `lib/routes/actions.ts` instead — a parcel on a trip is refused here by
 * `assign_order` itself.
 *
 * Every one of these goes through a locking RPC or an RLS-scoped update. The
 * important thing here is the ERROR MAPPING: `assign_order` is designed to lose
 * a race loudly, and if the UI swallows that as "something went wrong" the
 * dispatcher will retry and believe they assigned a rider who is actually
 * carrying someone else's parcel. Each SQLSTATE gets its own honest message.
 */

export type DispatchResult =
  | { ok: true; message: string }
  | { ok: false; message: string; retry: boolean }

function refresh() {
  revalidatePath('/admin/dispatcher')
}

/**
 * One-click assign.
 *
 * The whole point of routing through `assign_order` rather than an UPDATE is
 * that the RPC takes `SELECT ... FOR UPDATE` on the order and then the rider, in
 * that fixed order. Two dispatchers clicking simultaneously: one wins, the other
 * blocks on the lock and then fails `order_not_assignable`. Verified with two
 * concurrent sessions — see docs/ARCHITECTURE.md Appendix B.
 */
export async function assignOrder(orderId: string, riderId: string): Promise<DispatchResult> {
  try {
    await assertRole('dispatcher', 'super_admin')
  } catch {
    return { ok: false, message: 'You do not have permission to assign riders.', retry: false }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('assign_order', {
    p_order_id: orderId,
    p_rider_id: riderId,
  })

  if (error) {
    const { message, retry } = explainDispatchError(error.message)
    refresh()
    return { ok: false, message, retry }
  }

  refresh()
  const assigned = data as unknown as { code?: string } | null
  return { ok: true, message: `${assigned?.code ?? 'Order'} assigned.` }
}

/**
 * Return an order to the queue.
 *
 * Goes through a plain UPDATE rather than an RPC because the state machine
 * trigger does the real work: `assigned -> pending` wipes rider_id, the
 * commission snapshot and cod_status, and the audit trigger releases the rider's
 * capacity. Doing that by hand here would duplicate DB logic and drift from it.
 */
export async function unassignOrder(orderId: string, reason?: string): Promise<DispatchResult> {
  try {
    await assertRole('dispatcher', 'super_admin')
  } catch {
    return { ok: false, message: 'You do not have permission to do that.', retry: false }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('orders')
    .update({ status: 'pending', cancel_reason: null, fail_reason: reason ?? null })
    .eq('id', orderId)
    .in('status', ['assigned', 'failed'])

  if (error) {
    const { message, retry } = explainDispatchError(error.message)
    refresh()
    return { ok: false, message, retry }
  }

  refresh()
  return { ok: true, message: 'Order returned to the queue.' }
}

export async function cancelOrderAsDispatch(
  orderId: string,
  reason: string,
): Promise<DispatchResult> {
  try {
    await assertRole('dispatcher', 'super_admin')
  } catch {
    return { ok: false, message: 'You do not have permission to do that.', retry: false }
  }
  if (!reason.trim()) {
    return { ok: false, message: 'A cancellation reason is required.', retry: false }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('orders')
    .update({ status: 'cancelled', cancel_reason: reason.trim() })
    .eq('id', orderId)
    // picked_up cannot be cancelled: the rider is holding the parcel. The DB
    // state machine enforces this too; the filter just avoids a pointless round
    // trip and a confusing error.
    .in('status', ['pending', 'assigned', 'failed'] satisfies OrderStatus[])

  if (error) {
    const { message, retry } = explainDispatchError(error.message)
    refresh()
    return { ok: false, message, retry }
  }

  refresh()
  return { ok: true, message: 'Order cancelled.' }
}
