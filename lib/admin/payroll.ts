'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertRole } from '@/lib/auth/guards'
import { explainAdminError } from '@/lib/admin/errors'
import {
  ADJUSTMENT_CATEGORIES,
  isPayslipMethod,
  monthLabel,
  parseMonth,
  type AdjustmentCategory,
} from '@/lib/payroll/payroll'
import { formatMmk } from '@/lib/utils'

export type PayrollResult = { ok: true; message: string } | { ok: false; message: string }

async function officeClient() {
  await assertRole('super_admin')
  return createClient()
}

function refresh() {
  revalidatePath('/admin/payroll')
  revalidatePath('/admin/super/riders')
  revalidatePath('/rider/payslips')
  revalidatePath('/rider/earnings')
}

/**
 * Lock a month (0057): creates the payslips and freezes the lines they cover.
 * Everything that makes this safe -- ended months only, no open runs, once --
 * is in lock_pay_period; this maps its refusals to sentences.
 */
export async function lockPayPeriod(month: string): Promise<PayrollResult> {
  const m = parseMonth(month)
  if (!m) return { ok: false, message: 'Choose a month.' }
  let supabase
  try {
    supabase = await officeClient()
  } catch {
    return { ok: false, message: 'Only a Super Admin can run payroll.' }
  }
  const { data, error } = await supabase.rpc('lock_pay_period', { p_month: m })
  if (error) return { ok: false, message: explainAdminError(error.message) }
  refresh()
  const n = Number(data ?? 0)
  return { ok: true, message: `${monthLabel(m)} locked: ${n} payslip${n === 1 ? '' : 's'} created.` }
}

/** Pay a locked payslip, once, with method and reference. */
export async function recordPayslipPayment(
  payslipId: string,
  method: string,
  reference: string,
): Promise<PayrollResult> {
  if (!isPayslipMethod(method)) return { ok: false, message: 'Choose how the rider was paid.' }
  if (method !== 'cash' && reference.trim() === '') {
    return { ok: false, message: 'Enter the bank or wallet transaction reference.' }
  }
  let supabase
  try {
    supabase = await officeClient()
  } catch {
    return { ok: false, message: 'Only a Super Admin can record salary payments.' }
  }
  const { data, error } = await supabase.rpc('record_payslip_payment', {
    p_payslip_id: payslipId,
    p_method: method,
    p_reference: reference || undefined,
  })
  if (error) return { ok: false, message: explainAdminError(error.message) }
  refresh()
  return { ok: true, message: `Payment of ${formatMmk(Number(data?.net ?? 0))} recorded.` }
}

/**
 * A deduction or bonus aimed at a month. An ordinary `adjustment` ledger line
 * with a category and pay_month: the 0055 insert policy requires the reason,
 * and its trigger writes the audit entry. Positive = deduction.
 */
export async function bookPayrollAdjustment(input: {
  riderId: string
  month: string
  category: string
  direction: 'deduction' | 'bonus'
  amount: number
  reason: string
}): Promise<PayrollResult> {
  const m = parseMonth(input.month)
  if (!m) return { ok: false, message: 'Choose a month.' }
  if (!(ADJUSTMENT_CATEGORIES as readonly string[]).includes(input.category)) {
    return { ok: false, message: 'Choose a category.' }
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, message: 'Enter a whole amount in kyat, greater than zero.' }
  }
  if (input.reason.trim().length < 3) return { ok: false, message: 'Give a reason — this line is permanent.' }

  let supabase
  let userId: string
  try {
    const ctx = await assertRole('super_admin')
    userId = ctx.userId
    supabase = await createClient()
  } catch {
    return { ok: false, message: 'Only a Super Admin can book deductions and bonuses.' }
  }

  const { error } = await supabase.from('cod_ledger').insert({
    rider_id: input.riderId,
    kind: 'adjustment',
    amount: input.direction === 'deduction' ? input.amount : -input.amount,
    memo: input.reason.trim(),
    category: input.category as AdjustmentCategory,
    pay_month: m,
    created_by: userId,
  })
  if (error) return { ok: false, message: explainAdminError(error.message) }
  refresh()
  return {
    ok: true,
    message: `${input.direction === 'deduction' ? 'Deduction' : 'Bonus'} of ${formatMmk(input.amount)} booked for ${monthLabel(m)}.`,
  }
}
