/**
 * Admin-facing error messages.
 *
 * Separate from the `'use server'` module so it is unit-testable. The settlement
 * conditions matter most: an operator who does not understand *why* a settlement
 * refused an action will reach for SQL, and hand-editing a ledger is exactly
 * what this system is built to prevent.
 */

const RULES: Array<[RegExp, string]> = [
  [
    /settlement_locked/i,
    'This settlement is already approved or paid. Reopen it first, or book a correcting adjustment.',
  ],
  [/settlement_not_approvable/i, 'Only a drafted (submitted) settlement can be approved.'],
  [/settlement_not_payable/i, 'Approve the settlement before marking it paid.'],
  [
    /settlement_not_reopenable/i,
    'Only an approved settlement can be reopened. A paid settlement is final — book an adjustment instead.',
  ],
  [/settlement_not_found/i, 'That settlement no longer exists.'],
  // 0055. Before the generic 42501 rule below, which would swallow these.
  [
    /rider_has_open_run/i,
    "This rider still has a run out or back at the hub. Close it and deposit its cash on the Ways board, then build the settlement.",
  ],
  [
    /cod_ledger_append_only/i,
    'Ledger lines are never edited or deleted. Book a correcting adjustment instead.',
  ],
  [/cod_ledger_adjustment_reason/i, 'An adjustment needs a reason of at least 3 characters.'],
  // 0056. Shop payouts.
  [
    /payout_exceeds_available/i,
    'That is more than has reached the office for this shop. Only cleared money — cash from closed runs and confirmed KBZPay — can be paid out.',
  ],
  [/payout_reference_required/i, 'Enter the transaction reference for this transfer.'],
  [/payout_recipient_required/i, 'Name the sender this Direct payout went to.'],
  [/payout_method_unknown/i, 'Choose how the shop was paid.'],
  [/shop_ledger_append_only/i, 'Payouts are never edited or deleted.'],
  // 0057. Payroll.
  [/period_locked/i, 'That month is already locked. Corrections go on next month as adjustments.'],
  [/period_not_ended/i, 'A month can only be locked after it ends.'],
  [
    /period_has_open_runs/i,
    'Some runs dated in or before this month are still open. Close or cancel them on the Ways board first.',
  ],
  [/payslip_already_paid/i, 'This payslip has already been paid.'],
  [/payslip_nothing_to_pay/i, 'Deductions cover the whole month — there is nothing to pay.'],
  [/payslip_reference_required/i, 'Enter the bank or wallet transaction reference.'],
  [/payslip_immutable|pay_period_immutable/i, 'Payslips and locked months cannot be changed. Book an adjustment next month.'],
  [/cod_ledger_already_on_payslip/i, 'That line has already been paid on a payslip.'],
  [
    /amount_exceeds_cash_in_hand/i,
    'That is more than the rider is holding. Check the amount against their balance.',
  ],
  [/amount_must_be_positive/i, 'Enter an amount greater than zero.'],
  [/reason_required/i, 'A reason is required.'],
  [
    /rider_field_admin_only|coverage_increase_admin_only/i,
    'Those rider fields are Super Admin only — check you are signed in as one.',
  ],
  [/role_change_forbidden/i, 'Only a Super Admin can change roles or suspend accounts.'],
  [
    /in_service_area/i,
    'That point is outside the Thingangyun service area. Widening the area needs a migration.',
  ],
  [/duplicate key|unique constraint/i, 'That already exists.'],
  [/forbidden|42501|permission denied|row-level security/i, 'You do not have permission to do that.'],
  [/failed to fetch|networkerror|load failed/i, 'Network problem — nothing was saved. Try again.'],
]

export function explainAdminError(raw: string | null | undefined): string {
  const text = raw ?? ''
  for (const [match, message] of RULES) {
    if (match.test(text)) return message
  }
  return 'Could not complete that. Nothing was saved.'
}
