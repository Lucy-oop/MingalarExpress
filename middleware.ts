import { NextResponse, type NextRequest } from 'next/server'
import { redirectWithSession, updateSession } from '@/lib/supabase/middleware'
import { AUTH_PAGES, ROLE_HOME, ROUTE_ROLES, matchPrefix } from '@/lib/auth/routes'

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

  /*
    Already signed in and staring at a login form? Send them home -- UNLESS
    home is the login form.

    A RETIRED ROLE'S HOME IS THE DOOR. `ROLE_HOME.dispatcher` is
    '/auth/login?error=role_retired' so that middleware never sends such an
    account into /admin, which would refuse it and bounce it home again. But
    that makes this branch the loop instead: the pathname of its destination is
    '/auth/login', which is an AUTH_PAGE, so it would redirect to itself until
    the browser gives up.

    Comparing the DESTINATION rather than special-casing the role keeps the
    rule true for whatever is retired next, and leaves the account on a page
    that explains itself instead of a dead tab.
  */
  if (user && role && isActive && AUTH_PAGES.includes(pathname)) {
    const home = new URL(ROLE_HOME[role], request.url)
    if (!AUTH_PAGES.includes(home.pathname)) {
      return redirectWithSession(home, response)
    }
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
