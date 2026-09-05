import { createClient } from '@/lib/supabase/server'

export type PublicSettings = {
  brandName: string | null
  supportPhone: string | null
}

const NONE: PublicSettings = { brandName: null, supportPhone: null }

/**
 * The handful of settings a signed-out page may see.
 *
 * Goes through the `public_settings()` definer RPC rather than the table:
 * `settings_read_all` grants SELECT to `authenticated` only, and the people who
 * most need the support number are the ones who cannot sign in. See migration
 * 0024 for why the function is narrow rather than the grant wide.
 *
 * NEVER THROWS. This is chrome on a login page — if the read fails, the number
 * is absent and the page still renders. A support affordance is not worth
 * taking a sign-in screen down for, and `ContactSupport` renders nothing for a
 * null number anyway.
 */
export async function getPublicSettings(): Promise<PublicSettings> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('public_settings')
    if (error || !data) return NONE

    const row = data as { brand_name?: string | null; support_phone?: string | null }
    return {
      brandName: row.brand_name ?? null,
      supportPhone: row.support_phone ?? null,
    }
  } catch {
    return NONE
  }
}
