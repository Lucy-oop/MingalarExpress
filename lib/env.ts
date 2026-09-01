/**
 * Supabase environment resolution.
 *
 * Why this exists: `createServerClient` throws when the URL or key is missing,
 * and because it is called from the root middleware that throw takes down EVERY
 * route -- including the public tracking page, which needs no session at all.
 * A missing env var turned into a total outage with an error pointing at a
 * Supabase dashboard URL.
 *
 * So: resolve once, let callers decide. Protected routes fail CLOSED (no client
 * means no user means redirect to login); public routes keep serving.
 */

export type SupabaseEnv = { url: string; anonKey: string }

let warned = false

export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    if (!warned) {
      warned = true
      console.error(
        '[env] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. ' +
          'Copy .env.example to .env.local and fill them in (`supabase status` prints both). ' +
          'Authentication is disabled and every protected route will redirect to /auth/login.',
      )
    }
    return null
  }
  return { url, anonKey }
}

/** For call sites that genuinely cannot proceed -- fails with an actionable message. */
export function requireSupabaseEnv(): SupabaseEnv {
  const env = getSupabaseEnv()
  if (!env) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.example).',
    )
  }
  return env
}
