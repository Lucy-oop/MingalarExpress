/**
 * Who may be handed a setup link, and why not.
 *
 * Pure and separate from the action so the refusals can be tested without a
 * database — and separate from `rider-setup.ts` because a `'use server'` module
 * may only export async functions, so a sync predicate cannot live there.
 *
 * THE RULES ARE A SECURITY BOUNDARY, not validation. A setup link signs its
 * bearer in as this rider, and a rider marks parcels collected and delivered
 * and carries COD cash. Each refusal below is the reason somebody cannot be
 * impersonated.
 */

export type RiderSetupSubject = {
  /** Null when the profile row is gone. */
  role: 'shop_owner' | 'rider' | 'dispatcher' | 'super_admin' | null
  isActive: boolean
}

export const SETUP_REFUSAL = {
  missing: 'That rider no longer exists.',
  notRider: 'That account is not a rider.',
  inactive:
    'This rider is held or suspended, so a setup link would not sign them in. Activate them first.',
} as const

/**
 * `null` means go ahead. Anything else is the message to show, and the reason
 * no link was minted.
 *
 * The inactive check is deliberately duplicated from `app/auth/callback`, which
 * already refuses to complete a sign-in for an inactive profile. That is the
 * real boundary; this one exists so the refusal happens at the counter, before
 * a rider has scanned a code that was never going to work, rather than after.
 */
export function setupRefusal(subject: RiderSetupSubject | null): string | null {
  if (!subject || subject.role === null) return SETUP_REFUSAL.missing
  if (subject.role !== 'rider') return SETUP_REFUSAL.notRider
  if (!subject.isActive) return SETUP_REFUSAL.inactive
  return null
}
