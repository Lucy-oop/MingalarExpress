/**
 * Maps GoTrue's sign-up failures to something a shop owner can act on.
 *
 * Outside `actions.ts` because a `'use server'` module may only export async
 * functions, so a mapper defined there could never be unit-tested — the same
 * reason lib/routes/errors.ts exists.
 *
 * WHY THIS IS NOT COSMETIC. Every branch here was previously one generic string,
 * and the two that actually happen are both invisible from the message:
 *
 *   - a phone already on file raises 23505 inside tg_on_auth_user_created and
 *     surfaces as "Database error saving new user"
 *   - Supabase's built-in SMTP allows a handful of confirmation emails per hour
 *     across the whole project, so the second shop to sign up in an hour gets a
 *     429 that has nothing to do with anything they typed
 *
 * Neither names a field, and a shop owner reading either concludes the site is
 * broken. Matching on `code` first and message text only as a fallback, because
 * the codes are stable and the prose is not.
 */

export type SignUpErrorKind =
  | 'email_taken'
  | 'email_invalid'
  | 'rate_limited'
  | 'weak_password'
  | 'unknown'

export type ExplainedSignUpError = {
  kind: SignUpErrorKind
  /** Which input to attach it to, or null for a form-level message. */
  field: 'email' | 'phone' | 'password' | null
  message: string
}

export function explainSignUpError(
  code: string | undefined,
  status: number | undefined,
  rawMessage: string,
): ExplainedSignUpError {
  const c = (code ?? '').toLowerCase()
  const text = rawMessage.toLowerCase()

  if (c === 'user_already_exists' || text.includes('already registered')) {
    return {
      kind: 'email_taken',
      field: null,
      message: 'An account with this email already exists.',
    }
  }

  /*
   * Supabase rejects addresses it considers undeliverable before any trigger
   * runs — including every `.test` domain, which is exactly what the seeded
   * accounts use. Somebody copying the pattern from `shop@mingalar.test` gets a
   * hard failure with no hint that the domain is the problem.
   */
  if (c === 'email_address_invalid' || (text.includes('email address') && text.includes('invalid'))) {
    return {
      kind: 'email_invalid',
      field: 'email',
      message: 'That email address was rejected. Use a real, deliverable address.',
    }
  }

  /*
   * 429, and the one most likely to be met in production. The honest answer is
   * that it is nothing they did — the real fix is project configuration: custom
   * SMTP, or no email confirmation at all, given the office verifies every shop
   * by hand anyway.
   */
  if (status === 429 || c.includes('rate_limit') || text.includes('rate limit')) {
    return {
      kind: 'rate_limited',
      field: null,
      message:
        'Too many sign-ups in the last hour, so the confirmation email could not be sent. ' +
        'Wait a little and try again, or ask the Mingalar Express office to create the account.',
    }
  }

  if (c === 'weak_password' || text.includes('password')) {
    return {
      kind: 'weak_password',
      field: 'password',
      message: 'Choose a longer or less common password.',
    }
  }

  return {
    kind: 'unknown',
    field: null,
    message:
      'Could not create the account. Please try again, or contact the Mingalar Express office.',
  }
}
