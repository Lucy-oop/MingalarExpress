/**
 * Shop payouts (0056): the channels the office pays through, and the checks
 * the payout form runs before the server repeats them.
 *
 * PURE, so the form, the server action and the tests share one list. The SQL
 * constraint `shop_ledger_method_known` is the authority; `payout.test.ts`
 * reads the migration to keep the two lists identical.
 */
export const PAYOUT_METHODS = ['cash', 'kbzpay', 'cbpay', 'wavepay', 'ayapay'] as const
export type PayoutMethod = (typeof PAYOUT_METHODS)[number]

export const PAYOUT_METHOD_LABEL: Record<PayoutMethod, { en: string; my: string }> = {
  cash: { en: 'Cash at the office desk', my: 'ရုံးတွင် ငွေသား' },
  kbzpay: { en: 'KBZPay', my: 'KBZPay' },
  cbpay: { en: 'CB Pay', my: 'CB Pay' },
  wavepay: { en: 'WavePay', my: 'WavePay' },
  ayapay: { en: 'AYA Pay', my: 'AYA Pay' },
}

export function isPayoutMethod(v: unknown): v is PayoutMethod {
  return typeof v === 'string' && (PAYOUT_METHODS as readonly string[]).includes(v)
}

export type PayoutProblem =
  | 'amount'
  | 'over_available'
  | 'method'
  | 'reference'
  | 'recipient'

/**
 * The first reason a payout cannot be recorded, or null. Mirrors
 * record_shop_payout: a whole positive amount no larger than what is
 * available, a known channel, a reference for any digital transfer (cash at
 * the desk may have none), and a named recipient for the Direct house shop.
 */
export function payoutProblem(input: {
  amount: number
  available: number
  method: string
  reference: string
  isDirect: boolean
  recipient: string
}): PayoutProblem | null {
  if (!Number.isInteger(input.amount) || input.amount <= 0) return 'amount'
  if (input.amount > input.available) return 'over_available'
  if (!isPayoutMethod(input.method)) return 'method'
  if (input.method !== 'cash' && input.reference.trim() === '') return 'reference'
  if (input.isDirect && input.recipient.trim() === '') return 'recipient'
  return null
}
