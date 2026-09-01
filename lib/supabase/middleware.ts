import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseEnv } from '@/lib/env'
import type { Database } from '@/types/database.types'
import type { UserRole } from '@/types/domain'

/**
 * Refreshes the Supabase session cookie and resolves the caller's role.
 *
 * Two rules this implementation exists to honour:
 *
 *  1. Always `getUser()`, never `getSession()`. getSession() trusts whatever is
 *     in the cookie; getUser() revalidates the JWT against the auth server.
 *  2. The returned `response` must be the one handed back to Next, and its
 *     cookies must be copied onto any redirect built from it -- otherwise the
 *     refreshed tokens are dropped and the user is logged out on next request.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  // Unconfigured: do NOT throw. Throwing here 500s every route, public ones
  // included. `configured: false` lets the caller fail closed on protected
  // paths while still serving /, /track/[code] and the auth pages.
  const env = getSupabaseEnv()
  if (!env) {
    return { response, user: null, role: null, isActive: false, configured: false as const }
  }

  const supabase = createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let role: UserRole | null = null
  let isActive = true

  if (user) {
    // Fast path: a Custom Access Token auth hook stamping `role` into
    // app_metadata makes this zero DB round-trips. Until that hook is enabled
    // (Phase 2 follow-up), fall back to one indexed primary-key read.
    const meta = user.app_metadata as { role?: UserRole; suspended?: boolean } | undefined
    const claimed = meta?.role

    if (meta?.suspended === true) {
      // Stamped by the Super Admin panel when an account is suspended.
      //
      // Without this the `claimed` branch below would wave a suspended account
      // through: it trusts app_metadata.role and never reads is_active, so any
      // admin-created account (every rider, and any shop owner promoted through
      // the Admin API) would clear the middleware while suspended. RLS still
      // refuses them everything -- auth_role() returns NULL for an inactive
      // profile -- but they would land on a broken page instead of the login
      // form, which reads as a bug rather than as a revoked account.
      role = claimed ?? null
      isActive = false
    } else if (claimed) {
      role = claimed
    } else {
      const { data } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .single()
      role = data?.role ?? null
      isActive = data?.is_active ?? false
    }
  }

  return { response, user, role, isActive, configured: true as const }
}

/**
 * Copies the refreshed auth cookies from `source` onto a redirect response.
 * Skipping this is the single most common cause of "it logs me out randomly".
 */
export function redirectWithSession(url: URL, source: NextResponse) {
  const redirect = NextResponse.redirect(url)
  for (const cookie of source.cookies.getAll()) {
    redirect.cookies.set(cookie)
  }
  return redirect
}
