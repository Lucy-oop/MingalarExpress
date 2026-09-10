'use server'

import { revalidatePath } from 'next/cache'
import { assertRole } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'

/**
 * The KBZPay verification queue.
 *
 * WHY THIS SCREEN EXISTS. A KPay delivery books NO ledger line — the rider never
 * held the money — so nothing in the nightly settlement will ever notice a
 * transfer that did not arrive. The only thing standing between a faked
 * screenshot and a written-off parcel is somebody comparing it to the bank, and
 * this is that somebody's screen.
 *
 * `cod_status = 'kpay_pending'` is the queue. It is a real state, not a
 * derivation, precisely so that "nobody has checked this yet" cannot be
 * confused with "checked and fine".
 */

export type KpayPending = {
  id: string
  code: string
  customerName: string
  shopName: string | null
  riderName: string | null
  codAmount: number
  deliveredAt: string | null
  receiptUrl: string | null
  proofUrl: string | null
}

export type KpayResult = { ok: true; message: string } | { ok: false; message: string }

/** How long a receipt link stays valid. Long enough to compare, not to circulate. */
const RECEIPT_TTL_SECONDS = 600

export async function getKpayQueue(): Promise<KpayPending[]> {
  await assertRole('super_admin')
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('orders')
    .select(
      `id, code, customer_name, cod_amount, delivered_at, kpay_proof_path, proof_photo_path,
       shops:shop_id (name)`,
    )
    .eq('collected_via', 'kpay')
    .eq('cod_status', 'kpay_pending')
    .order('delivered_at', { ascending: true })

  if (error) throw new Error(`KPay queue unavailable: ${error.message}`)

  // Signed one at a time rather than in a batch: a single unreadable object
  // must not blank the whole queue, which is the screen someone works from.
  return Promise.all(
    (data ?? []).map(async (o) => {
      const [receipt, proof] = await Promise.all([
        sign(supabase, o.kpay_proof_path),
        sign(supabase, o.proof_photo_path),
      ])
      // The rider's name needs a definer RPC — `profiles` is not shop-readable
      // and dispatch reads it through the same card the parcel page uses.
      const { data: card } = await supabase.rpc('order_rider_card', { p_order_id: o.id })
      const rider = card as { full_name?: string } | null
      return {
        id: o.id,
        code: o.code,
        customerName: o.customer_name,
        shopName: (o.shops as unknown as { name: string } | null)?.name ?? null,
        riderName: rider?.full_name ?? null,
        codAmount: o.cod_amount,
        deliveredAt: o.delivered_at,
        receiptUrl: receipt,
        proofUrl: proof,
      }
    }),
  )
}

async function sign(
  supabase: Awaited<ReturnType<typeof createClient>>,
  path: string | null,
): Promise<string | null> {
  if (!path) return null
  const { data } = await supabase.storage
    .from('delivery-proofs')
    .createSignedUrl(path, RECEIPT_TTL_SECONDS)
  return data?.signedUrl ?? null
}

export async function confirmKpay(orderId: string): Promise<KpayResult> {
  const ctx = await assertRole('super_admin').catch(() => null)
  if (!ctx) return { ok: false, message: 'Your session has expired. Sign in again.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('confirm_kpay_payment', { p_order_id: orderId })
  if (error) return { ok: false, message: explain(error.message) }

  revalidateKpay(orderId)
  return { ok: true, message: 'Payment confirmed. The money is closed out.' }
}

export async function rejectKpay(orderId: string, reason: string): Promise<KpayResult> {
  const ctx = await assertRole('super_admin').catch(() => null)
  if (!ctx) return { ok: false, message: 'Your session has expired. Sign in again.' }
  if (reason.trim().length < 4) {
    return { ok: false, message: 'Say what was wrong with the receipt.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('reject_kpay_payment', {
    p_order_id: orderId,
    p_reason: reason.trim(),
  })
  if (error) return { ok: false, message: explain(error.message) }

  revalidateKpay(orderId)
  return {
    ok: true,
    message: 'Rejected. The parcel stays delivered and the amount is now outstanding.',
  }
}

function revalidateKpay(orderId: string) {
  revalidatePath('/admin/kpay')
  revalidatePath('/admin/orders')
  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/admin/super')
}

function explain(raw: string): string {
  if (/kpay_already_decided/i.test(raw)) {
    return 'Somebody has already decided this one. Refresh the queue.'
  }
  if (/not_a_kpay_payment/i.test(raw)) return 'This parcel was not paid by KBZPay.'
  if (/reject_reason_required/i.test(raw)) return 'Say what was wrong with the receipt.'
  if (/order_not_found/i.test(raw)) return 'That order no longer exists.'
  if (/forbidden|42501/i.test(raw)) return 'You do not have permission to do that.'
  return `Could not save that: ${raw}`
}
