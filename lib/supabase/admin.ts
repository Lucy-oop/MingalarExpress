import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

/**
 * Service-role client. BYPASSES RLS ENTIRELY.
 *
 * The `server-only` import above turns any client-component import of this file
 * into a build error rather than a leaked key.
 *
 * Legitimate uses are narrow:
 *   - creating rider / dispatcher accounts (`auth.admin.createUser`), because
 *     `raw_app_meta_data.role` is the one role source the DB trigger trusts
 *   - nightly settlement drafts (`build_settlement` accepts a null-JWT caller
 *     via `is_service_ctx()`)
 *   - the phone-uniqueness check during PUBLIC SIGN-UP (`phoneTaken` in
 *     lib/auth/actions.ts), where there is no session for RLS to scope and the
 *     only alternative is a definer RPC granted to anon -- the same disclosure
 *     through more machinery
 *
 * Everything a logged-in human does must go through the anon client so RLS
 * applies. If you reach for this to "make a query work", the policy is wrong.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    /*
      NAME THE LIKELY CAUSE, because the obvious one is usually not it.

      This is the ONLY variable the app reads from process.env at RUNTIME —
      every other one is NEXT_PUBLIC_* and gets inlined into the bundle by
      `next build`. So when this is missing, the site is otherwise working
      perfectly: sign-in fine, pages fine, map tiles fine, and only account
      creation dead. The natural conclusion is that the key is wrong or absent,
      and .env.local is then found to be correct, which is a dead end.

      In Next 16, `next start` does NOT read .env.local — `next dev` does, and
      announces it with "- Environments: .env.local". That is why
      `scripts/start.mjs` exists and why package.json's `start` goes through
      it. If this fires locally, the server was very likely started with a bare
      `next start`.
    */
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Note that Next 16 `next start` ' +
        'does not read .env.local — start the server with `npm start`, which ' +
        'goes through scripts/start.mjs and loads it (see that file).',
    )
  }

  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
