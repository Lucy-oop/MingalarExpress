import { NextResponse, type NextRequest } from 'next/server'
import { redirectWithSession, updateSession } from '@/lib/supabase/middleware'
import type { UserRole } from '@/types/domain'

/**
 * Root middleware. Two jobs:
 *   1. Refresh the Supabase session cookie on every request (otherwise tokens
 *      expire mid-session and users get logged out at random).
 *   2. Coarse role gate on protected path prefixes.
 *
 * This is a UX gate, not the security boundary -- RLS is. Its purpose is to send
 * the wrong role somewhere sensible before rendering, not to be the thing
 * standing between a rider and the settlement tables.
 *
 * Next 16 also accepts this file as `proxy.ts`; `middleware.ts` remains valid.
 */

/**
 * Longest-prefix wins. '/admin/super' MUST be matched before '/admin', which is
 * why this is sorted by descending prefix length at module load rather than
 * relying on object key order.
 */
const ROUTE_ROLES: Record<string, readonly UserRole[]> = {
  '/admin/super': ['super_admin'],
  // Money and shop administration live outside /admin/super but are just as
  // restricted; each also calls requireAdmin in its own render path.
  '/admin/shops': ['super_admin'],
  '/admin/audit': ['super_admin'],
  '/admin/dispatcher': ['dispatcher', 'super_admin'],
  '/admin': ['dispatcher', 'super_admin'],
  '/shop': ['shop_owner'],
  '/rider': ['rider'],
}

const PROTECTED_PREFIXES = Object.keys(ROUTE_ROLES).sort((a, b) => b.length - a.length)

const ROLE_HOME: Record<UserRole, string> = {
  shop_owner: '/shop/dashboard',
  rider: '/rider/dashboard',
  dispatcher: '/admin/dispatcher',
  super_admin: '/admin/super',
}

/** Signed-in users have no business on the login/register forms. */
const AUTH_PAGES = ['/auth/login', '/auth/register']

function matchPrefix(pathname: string): string | undefined {
  return PROTECTED_PREFIXES.find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always refresh the session, even on public paths -- a visitor reading
  // /track/ABC should not have their tokens quietly expire.
  const { response, user, role, isActive, configured } = await updateSession(request)

  // Supabase not configured: serve public routes, fail closed on the rest.
  if (!configured) {
    const unprotected = !matchPrefix(pathname)
    if (unprotected) return response
    const url = new URL('/auth/login', request.url)
    url.searchParams.set('error', 'not_configured')
    return redirectWithSession(url, response)
  }

  // Already signed in and staring at a login form? Send them home.
  if (user && role && isActive && AUTH_PAGES.includes(pathname)) {
    return redirectWithSession(new URL(ROLE_HOME[role], request.url), response)
  }

  const prefix = matchPrefix(pathname)
  if (!prefix) return response

  if (!user) {
    const url = new URL('/auth/login', request.url)
    // Preserve intent so login can bounce them back to where they were going.
    url.searchParams.set('next', pathname + request.nextUrl.search)
    return redirectWithSession(url, response)
  }

  if (!isActive) {
    const url = new URL('/auth/login', request.url)
    url.searchParams.set('error', 'account_disabled')
    return redirectWithSession(url, response)
  }

  // Authenticated but role unresolvable (profile row missing). Do not guess.
  if (!role) {
    const url = new URL('/auth/login', request.url)
    url.searchParams.set('error', 'no_profile')
    return redirectWithSession(url, response)
  }

  if (!ROUTE_ROLES[prefix]!.includes(role)) {
    return redirectWithSession(new URL(ROLE_HOME[role], request.url), response)
  }

  return response
}

export const config = {
  /**
   * Run on everything except static assets and image optimisation. Excluding
   * `_next/static` matters: middleware on every chunk request would add a
   * getUser() round-trip per asset.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|woff2?)$).*)',
  ],
}
