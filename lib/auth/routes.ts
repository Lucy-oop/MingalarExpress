import type { UserRole } from '@/types/domain'

/**
 * The route map, in one place because it used to be in two.
 *
 * WHY THIS FILE EXISTS. `ROUTE_ROLES`, `ROLE_HOME` and `AUTH_PAGES` lived in
 * `middleware.ts`, and `ROLE_HOME` was ALSO copied into `lib/auth/guards.ts`
 * with a comment saying the two must agree and nothing checking that they did.
 * Duplicated because middleware runs on the edge runtime and guards.ts pulls in
 * the Supabase server client, which cannot go there.
 *
 * That constraint is real, but it only forbids sharing a module that imports
 * the client. This module imports one TYPE, erased at compile time, so both
 * sides can have it and the copies collapse into one. A test asserting two
 * literals match is a worse version of not having two literals.
 *
 * NOT THE SECURITY BOUNDARY. RLS is. This is the coarse gate that sends the
 * wrong role somewhere sensible before rendering, plus the render-path guards
 * in guards.ts that a matcher gap cannot skip.
 */

/**
 * Longest-prefix wins; `PROTECTED_PREFIXES` below is sorted for that.
 *
 * FOUR /admin ENTRIES COLLAPSED INTO ONE when the dispatcher role was retired.
 * They carved admin-only pockets -- /admin/super, /admin/shops, /admin/audit --
 * out of an /admin that dispatchers could otherwise enter. With one office role
 * the whole tree is `super_admin`, and four rules saying so were four places to
 * forget when a page is added. The next /admin route is gated correctly by
 * default instead of needing a line here.
 *
 * The longest-prefix machinery stays: /shop and /rider still need it, and an
 * admin-only pocket may come back if a second office login is ever granted
 * along the requireDispatch / requireAdmin line (see guards.ts).
 */
export const ROUTE_ROLES: Record<string, readonly UserRole[]> = {
  '/admin': ['super_admin'],
  '/shop': ['shop_owner'],
  '/rider': ['rider'],
}

export const PROTECTED_PREFIXES = Object.keys(ROUTE_ROLES).sort((a, b) => b.length - a.length)

/**
 * Where each role belongs after signing in.
 *
 * `dispatcher` POINTS AWAY FROM THE APP, and that is the whole trick. The role
 * is retired: `/admin` requires `super_admin`, so naming any `/admin` path as a
 * dispatcher's home would have middleware send them to a page that refuses
 * them, which sends them home again, forever. A retired role has to be shown
 * the door, not a room.
 *
 * The value is honest and reachable -- the login page renders `role_retired` as
 * a sentence a person can act on. Nothing should hit it: the one dispatcher
 * account was deleted with this change. But `user_role` still carries the value
 * (the schema keeps it for `audit_log.actor_role` and friends), so TypeScript
 * makes us answer the question, and this is the answer.
 *
 * Middleware's "already signed in, go home" branch compares the DESTINATION
 * against AUTH_PAGES for this reason -- otherwise this entry redirects to
 * itself.
 */
export const ROLE_HOME: Record<UserRole, string> = {
  shop_owner: '/shop/dashboard',
  rider: '/rider/dashboard',
  dispatcher: '/auth/login?error=role_retired',
  super_admin: '/admin',
}

/** Signed-in users have no business on the login/register forms. */
export const AUTH_PAGES = ['/auth/login', '/auth/register']

/** The `ROUTE_ROLES` prefix governing `pathname`, longest first. */
export function matchPrefix(pathname: string): string | undefined {
  return PROTECTED_PREFIXES.find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
