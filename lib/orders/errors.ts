/**
 * Maps `resolve_failed_order`'s raise conditions to something a shop can act on.
 *
 * Separate from `actions.ts` because a `'use server'` module may only export
 * async functions, so a mapper defined there could never be unit-tested.
 *
 * The two that matter are the race conditions. A shop looking at a failed parcel
 * is looking at a snapshot: by the time they press a button, dispatch may already
 * have put it on another run, or the office may have cancelled it. Saying so
 * plainly is the difference between a shop trusting the screen and a shop
 * telephoning the office.
 */

const MAP: Array<[RegExp, string]> = [
  [
    /order_in_flight/i,
    'A rider is carrying this parcel again right now. Wait for this attempt to finish, then decide.',
  ],
  [
    /order_closed/i,
    'This order is already closed — it was delivered or cancelled. Refresh to see where it ended up.',
  ],
  [
    /order_never_failed/i,
    'This parcel has not failed a delivery, so there is nothing to decide. Cancel it instead if you no longer want it sent.',
  ],
  [/order_not_found/i, 'That order no longer exists.'],
  [/bad_resolution/i, 'That is not a choice we can act on.'],
  [
    /forbidden|42501|permission denied|row-level security/i,
    'You do not have permission to change this order.',
  ],
]

export function explainResolutionError(raw: string | null | undefined): string {
  const text = raw ?? ''
  for (const [match, message] of MAP) {
    if (match.test(text)) return message
  }
  return 'Could not save that decision. Refresh the page and try again.'
}
