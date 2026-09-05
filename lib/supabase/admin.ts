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
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
