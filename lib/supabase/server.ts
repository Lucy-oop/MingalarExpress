import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requireSupabaseEnv } from '@/lib/env'
import type { Database } from '@/types/database.types'

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * `cookies()` is async in Next 15+, so this is async too -- always `await` it.
 *
 * Server Components cannot write cookies. That is not a bug to work around: the
 * root middleware has already refreshed the session before the request reaches
 * any component, so the swallowed error below is the expected path, not a
 * failure. Remove the try/catch and every RSC render throws.
 */
export async function createClient() {
  const cookieStore = await cookies()
  const { url, anonKey } = requireSupabaseEnv()

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Called from a Server Component. Middleware owns cookie writes.
        }
      },
    },
  })
}
