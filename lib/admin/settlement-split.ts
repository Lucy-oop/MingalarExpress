/**
 * A settlement's ledger lines, split the way the office pays (0053).
 *
 * Riders hand in 100% of their cash every run (0052) and are paid their
 * earnings at the monthly settlement. So a settlement is two separate
 * questions, never one netted figure:
 *
 *   EARNINGS  what the platform pays the rider: run pay, parcel pay and
 *             commission, less adjustments booked against them
 *   CASH      what the rider collected and handed in. With every run deposited
 *             at close, what is still outstanding is 0 -- anything else is
 *             cash nobody has recorded coming back, and is flagged, not netted
 *
 * Sign convention is the ledger's: positive = owed BY the rider, negative =
 * owed TO the rider. Every figure returned here is a positive amount.
 */
export type SettlementLineLike = { kind: string; amount: number }

export type SettlementSplit = {
  cashCollected: number
  cashDeposited: number
  /** Collected less deposited. 0 when every run was closed and deposited. */
  cashOutstanding: number
  /** Run pay + parcel pay + commission. */
  earnings: number
  /** Adjustments and platform fees booked against the rider (positive = deducted). */
  deductions: number
  /** What to disburse to the rider: earnings less deductions. */
  earningsToPay: number
}

const EARNING_KINDS = new Set(['commission_earned', 'trip_pay', 'pickup_pay'])
const DEDUCTION_KINDS = new Set(['adjustment', 'platform_fee'])

export function splitSettlement(lines: readonly SettlementLineLike[]): SettlementSplit {
  let cashCollected = 0
  let cashDeposited = 0
  let earnings = 0
  let deductions = 0
  for (const l of lines) {
    const a = Number(l.amount)
    if (l.kind === 'cod_collected') cashCollected += a
    else if (l.kind === 'cod_remitted') cashDeposited -= a
    else if (EARNING_KINDS.has(l.kind)) earnings -= a
    else if (DEDUCTION_KINDS.has(l.kind)) deductions += a
  }
  return {
    cashCollected,
    cashDeposited,
    cashOutstanding: cashCollected - cashDeposited,
    earnings,
    deductions,
    earningsToPay: earnings - deductions,
  }
}
