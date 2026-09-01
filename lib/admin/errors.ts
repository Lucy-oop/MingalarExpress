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
