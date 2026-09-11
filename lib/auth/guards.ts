import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile, UserRole } from '@/types/domain'
// The route map lives in its own module so middleware (edge runtime) and this
// file (Supabase server client) can share one copy. Imported for requireRole
// below, and re-exported because a dozen callers already take ROLE_HOME from
// here.
import { ROLE_HOME } from '@/lib/auth/routes'
export { ROLE_HOME }

/**
 * Server-side authorisation. Called at the top of every protected layout.
 *
 * This duplicates the root middleware check on purpose. Middleware is a UX gate
 * that runs on matched paths; this runs in the render path and cannot be skipped
 * by a matcher gap, a rewrite, or a directly-invoked Server Action. Neither is
 * the real boundary -- RLS is -- but three layers means a mistake in one is not
 * a data leak.
 */

export type AuthContext = {
  userId: string
  email: string | null
  profile: Profile
}

/**
 * Who is signed in, fetched AT MOST ONCE PER REQUEST.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS: IT WAS THE LARGEST SINGLE SOURCE OF LATENCY
 *
 * `auth.getUser()` is not a cookie read. `@supabase/ssr` calls GoTrue's
 * `/auth/v1/user` to verify the JWT against the server, and against this
 * project that measures 190-870ms. The `profiles` read beside it measures
 * 175-340ms. Neither is avoidable per se -- but they were being paid over and
 * over inside a single render:
 *
 *     /admin           layout guard + page guard          = 4 round trips
 *     /shop/dashboard  layout guard + page guard          = 4
 *     /admin/super     admin layout + super layout        = 6
 *
 * Three `getUser()` calls and three or four `profiles` reads per cold page
 * load, every one of them strictly sequential, for an answer that cannot
 * change within one request. On `/shop/dashboard` the whole chain came to ten
 * sequential round trips and twenty HTTP requests.
 *
 * `React.cache` memoises per REQUEST, not across requests, so this is not a
 * cache in the stale-data sense: the second guard in the same render gets the
 * first one's answer, and the next request starts clean. No revalidation to
 * get wrong, no window in which a suspended account still renders.
 *
 * ---------------------------------------------------------------------------
 * THE REDIRECTS STAY OUTSIDE
 *
 * This returns data and never redirects. `redirect()` throws, and a cached
 * function that throws caches the throw -- which would work, but it would make
 * the memo a control-flow device and the next reader would have to reason about
 * it. Keeping the cache a plain value and the policy in `requireUser` means
 * the interesting part stays readable.
 *
 * Nothing else changes: the three-layer discipline in the docblock above is
 * intact. Every guard still checks, on every render. They just stop asking the
 * same question over the network three times.
 */
const loadAuth = cache(async (): Promise<{ user: { id: string; email: string | null }; profile: Profile | null } | null> => {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return { user: { id: user.id, email: user.email ?? null }, profile: profile ?? null }
})

/** Authenticated session + profile, or a redirect to login. */
export async function requireUser(): Promise<AuthContext> {
  const auth = await loadAuth()
  if (!auth) redirect('/auth/login')

  // Authenticated but no profile: the signup trigger did not run. Failing to
  // login (rather than rendering a broken shell) makes this loud.
  if (!auth.profile) redirect('/auth/login?error=no_profile')
  if (!auth.profile.is_active) redirect('/auth/login?error=account_disabled')

  return { userId: auth.user.id, email: auth.user.email, profile: auth.profile }
}

/**
 * Who is reading this, if anyone. NEVER redirects.
 *
 * Every other guard in this file is a gate: no session means a redirect to
 * login. A PUBLIC page cannot do that -- being signed out is the normal case
 * there, not a failure -- but it may still want to know, so `/contact` can
 * offer a shop owner the way back to their shop instead of a button reading
 * "Back to sign in", which on a signed-in screen looks like a way to log out.
 *
 * NOT AN AUTHORISATION CHECK, and nothing may be granted on the strength of it.
 * It answers a presentation question. `requireRole` and RLS remain the gates.
 *
 * Cheap where it matters: with no session cookie `getUser()` returns null
 * without a network call, so an anonymous visitor pays nothing.
 */
export async function optionalUser(): Promise<AuthContext | null> {
  try {
    // Shares `loadAuth`'s per-request memo, so a public page that also renders
    // a guarded fragment pays for the lookup once between them.
    const auth = await loadAuth()
    if (!auth) return null

    // A disabled account is treated as signed out here. It is about to be
    // signed out for real by the next gate it meets, and pointing it at a
    // role home it cannot open would be a worse dead end than the login page.
    if (!auth.profile || !auth.profile.is_active) return null

    return { userId: auth.user.id, email: auth.user.email, profile: auth.profile }
  } catch {
    // A public page must render whatever auth is doing. Same rule
    // `getPublicSettings` follows for the same reason.
    return null
  }
}

/**
 * Require one of `allowed`. A signed-in user with the wrong role is sent to
 * their own home, not to login -- bouncing a logged-in rider to a login form
 * reads as "you are logged out" and produces support calls.
 */
export async function requireRole(...allowed: UserRole[]): Promise<AuthContext> {
  const ctx = await requireUser()
  if (!allowed.includes(ctx.profile.role)) redirect(ROLE_HOME[ctx.profile.role])
  return ctx
}

export const requireShop = () => requireRole('shop_owner')
export const requireRider = () => requireRole('rider')
/**
 * Whoever runs the office. Since the dispatcher role was retired that is
 * `super_admin` and nothing else, so this is now the same gate as
 * `requireAdmin`.
 *
 * KEPT AS A SEPARATE NAME ON PURPOSE, rather than collapsed into
 * `requireAdmin` at ~30 call sites. The two say different things: pages behind
 * `requireDispatch` are the day's WORK -- the run board, the parcel search, the
 * KBZPay queue -- and pages behind `requireAdmin` are the business's SETTINGS
 * and its MONEY. That line is real even while one person is on both sides of
 * it, and it is the line a second office login would be granted along. Merging
 * the names would erase the distinction and make re-drawing it a re-audit of
 * every admin route.
 */
export const requireDispatch = () => requireRole('super_admin')
export const requireAdmin = () => requireRole('super_admin')

// ---------------------------------------------------------------------------
// Predicate helpers mirroring the SQL functions of the same names, so app code
// and policy code agree on what a role means.
//
//   SQL public.is_admin()        <-> isAdmin(role)
//   SQL public.is_dispatch()     <-> isDispatch(role)
//   SQL public.is_service_ctx()  <-> isServiceContext()
// ---------------------------------------------------------------------------

export const isAdmin = (role: UserRole | null | undefined): boolean => role === 'super_admin'

/**
 * DELIBERATELY NO LONGER A MIRROR OF SQL `is_dispatch()`, which is the one
 * place in this file where the app and the database disagree on purpose.
 *
 *   SQL   public.is_dispatch()  ->  auth_role() in ('super_admin','dispatcher')
 *   here  isDispatch(role)      ->  role === 'super_admin'
 *
 * The dispatcher role was retired from the PRODUCT, not from the schema. The
 * enum value stays because `audit_log.actor_role`,
 * `order_status_events.actor_role` and `order_notes.author_role` hold history
 * written by dispatchers, and because two SQL suites assert the dispatcher
 * boundary (`settlement_flow.sql` -- "a dispatcher cannot remit cash or
 * settle") which is worth keeping as proof the money boundary never moved.
 *
 * So SQL stays permissive toward a role that can no longer log in, and the app
 * is the thing that refuses it. Safe in that direction only: the app is
 * strictly narrower than the policy, never wider. Do NOT "fix" the SQL to
 * match -- that is 16 policies and 18 functions for no gain.
 */
export const isDispatch = (role: UserRole | null | undefined): boolean =>
  role === 'super_admin'

export const isRider = (role: UserRole | null | undefined): boolean => role === 'rider'

export const isShop = (role: UserRole | null | undefined): boolean => role === 'shop_owner'

/**
 * Mirrors SQL `public.is_service_ctx()`: true when there is no end-user JWT, so
 * the caller is the service role, pg_cron, or a psql session.
 *
 * In the app this is only ever true on the server holding the service-role key.
 * It is a readability helper for code paths shared between a user request and a
 * cron invocation -- it is NOT an authorisation check. Never write
 * `if (isServiceContext()) allow()` in a request handler: the request has a
 * user, and the correct question is that user's role.
 */
export function isServiceContext(userId?: string | null): boolean {
  return !userId
}

/** Throws instead of redirecting. For Server Actions and Route Handlers. */
export async function assertRole(...allowed: UserRole[]): Promise<AuthContext> {
  /*
    Also on the memo. A Server Action is its own request, so this is usually
    the only caller in it — but an action that renders after itself, or a route
    handler that guards twice, now pays once.
  */
  const auth = await loadAuth()
  if (!auth) throw new Error('unauthenticated')
  if (!auth.profile || !auth.profile.is_active) throw new Error('unauthenticated')
  if (!allowed.includes(auth.profile.role)) throw new Error('forbidden')

  return { userId: auth.user.id, email: auth.user.email, profile: auth.profile }
}
