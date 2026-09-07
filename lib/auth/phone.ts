import { createAdminClient } from '@/lib/supabase/admin'

export const PHONE_TAKEN =
  'This phone number is already registered. Sign in instead, or use another number.'

export const PHONE_TAKEN_ADMIN = 'That mobile number is already on another account.'

/**
 * Is this number already on a profile?
 *
 * WHY EVERY CALLER HAS TO ASK THIS, rather than reading it off the failure.
 * `profiles.phone` carries a partial UNIQUE index (profiles_phone_key) and
 * tg_on_auth_user_created inserts the profile inside the auth.users insert, so
 * a reused number raises 23505 and rolls the whole thing back. What GoTrue then
 * hands the client is:
 *
 *     message "Database error creating new user"   code undefined   status 500
 *
 * Verified against staging through supabase-js, not assumed. The constraint
 * name is in the Postgres error and in the raw REST response, and it is gone by
 * the time the SDK returns — so matching on `profiles_phone_key` in the message
 * is dead code. `lib/admin/shop-actions.ts` had exactly that and it had never
 * once fired.
 *
 * Asking the database again is the only reliable way to tell "the number is
 * taken" from "something else broke", which is why the public signup path does
 * it and why this now lives somewhere both admin paths can reach.
 *
 * USES THE SERVICE ROLE, deliberately. Signup is unauthenticated: there is no
 * session for RLS to scope, and `profiles` is readable by nobody anonymous --
 * correctly, since it holds every rider's and every shop owner's number. What
 * crosses the boundary is one boolean about a number the caller already typed.
 */
export async function phoneTaken(e164: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('profiles')
      .select('id')
      .eq('phone', e164)
      .limit(1)
      .maybeSingle()
    return !!data
  } catch {
    // Never block a registration because this check could not run. The unique
    // index is still there; the worst case is the old opaque error, not a bad
    // row.
    return false
  }
}
