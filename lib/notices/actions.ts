'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * "I have looked at the bell."
 *
 * SHARED BY BOTH SHELLS. The office bell and the shop bell mark the same
 * column, because the marker is a fact about the READER: no profile reads both
 * feeds, so one timestamp per person is enough. It lives here rather than in
 * `lib/admin` for that reason — a shop owner importing an admin action would be
 * a lie about who it is for.
 *
 * Writes `notices_seen_at` on the CALLER'S OWN profile through
 * `profiles_update_self` — the same path `setLocale` has used since the language
 * switcher shipped. Not `admin()`: a dispatcher reads this feed too, and the
 * marker is a fact about the reader rather than an administrative act, so
 * requiring super_admin would leave every dispatcher — and every shop owner —
 * with a badge they could never clear.
 *
 * `tg_profiles_guard` protects exactly `role` and `is_active`, so this needs no
 * exemption from it — and because RLS scopes the update to `id = auth.uid()`,
 * the id is never taken from the caller. There is nothing to pass in and nothing
 * to spoof.
 *
 * NOT AWAITED BY THE UI, and it returns void for that reason. The worst outcome
 * of a failure is a count that stays up until the next visit; blocking a
 * dropdown from opening while a round trip clears a badge would be worse than
 * the badge.
 */
export async function markNoticesSeen(): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const { error } = await supabase
    .from('profiles')
    .update({ notices_seen_at: new Date().toISOString() })
    .eq('id', user.id)

  if (error) {
    // Logged, not surfaced. See above: a stale badge is not worth a red alert.
    console.error(`[markNoticesSeen] ${user.id}: ${error.message}`)
  }
}
