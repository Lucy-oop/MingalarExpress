'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertRole } from '@/lib/auth/guards'
import { explainAdminError } from '@/lib/admin/errors'
import { payoutProblem } from '@/lib/shops/payout'
import { formatMmk } from '@/lib/utils'

export type PayoutResult =
  | { ok: true; message: string; available: number }
  | { ok: false; message: string }

const PROBLEM_MESSAGE: Record<string, string> = {
  amount: 'Enter a whole amount in kyat, greater than zero.',
  over_available: 'That is more than is available to pay this shop.',
  method: 'Choose how the shop was paid.',
  reference: 'Enter the transaction reference for this transfer.',
  recipient: 'Name the sender this Direct payout went to.',
}

/**
 * Record a payout to a shop (0056).
 *
 * The form's checks are repeated here with `payoutProblem`, and again -- as
 * the authority -- inside `record_shop_payout`, which locks the shop row so
 * two admins cannot both pay out the same balance. That function writes the
 * one append-only shop_ledger row; its trigger writes the audit entry.
 */
export async function recordShopPayout(input: {
  shopId: string
  amount: number
  available: number
  method: string
  reference: string
  memo: string
  isDirect: boolean
  recipient: string
}): Promise<PayoutResult> {
  try {
    await assertRole('super_admin')
  } catch {
    return { ok: false, message: 'Only a Super Admin can record payouts.' }
  }

  const problem = payoutProblem(input)
  if (problem) return { ok: false, message: PROBLEM_MESSAGE[problem] ?? 'Check the payout.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('record_shop_payout', {
    p_shop_id: input.shopId,
    p_amount: input.amount,
    p_method: input.method,
    p_reference: input.reference || undefined,
    p_memo: input.memo || undefined,
    p_recipient: input.recipient || undefined,
  })
  if (error) return { ok: false, message: explainAdminError(error.message) }

  revalidatePath('/admin/audit')
  revalidatePath('/shop/money')
  const available = Number(data ?? 0)
  return {
    ok: true,
    message: `Payout of ${formatMmk(input.amount)} recorded. ${formatMmk(available)} still available for this shop.`,
    available,
  }
}
