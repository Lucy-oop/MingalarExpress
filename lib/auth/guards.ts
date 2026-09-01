import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile, UserRole } from '@/types/domain'

/**
 * Server-side authorisation. Called at the top of every protected layout.
 *
 * This duplicates the root middleware check on purpose. Middleware is a UX gate
 * that runs on matched paths; this runs in the render path and cannot be skipped
 * by a matcher gap, a rewrite, or a directly-invoked Server Action. Neither is
 * the real boundary -- RLS is -- but three layers means a mistake in one is not
 * a data leak.
 */

export const ROLE_HOME: Record<UserRole, string> = {
  shop_owner: '/shop/dashboard',
  rider: '/rider/dashboard',
  dispatcher: '/admin/dispatcher',
  super_admin: '/admin/super',
}

export type AuthContext = {
  userId: string
  email: string | null
  profile: Profile
}

/** Authenticated session + profile, or a redirect to login. */
export async function requireUser(): Promise<AuthContext> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // Authenticated but no profile: the signup trigger did not run. Failing to
  // login (rather than rendering a broken shell) makes this loud.
  if (!profile) redirect('/auth/login?error=no_profile')
  if (!profile.is_active) redirect('/auth/login?error=account_disabled')

  return { userId: user.id, email: user.email ?? null, profile }
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
export const requireDispatch = () => requireRole('dispatcher', 'super_admin')
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

export const isDispatch = (role: UserRole | null | undefined): boolean =>
  role === 'super_admin' || role === 'dispatcher'

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
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('unauthenticated')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.is_active) throw new Error('unauthenticated')
  if (!allowed.includes(profile.role)) throw new Error('forbidden')

  return { userId: user.id, email: user.email ?? null, profile }
}
