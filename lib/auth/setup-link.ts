import { headers } from 'next/headers'

/**
 * Turn `generateLink`'s token hash into a URL that actually signs somebody in.
 *
 * NEVER HAND OUT `link.properties.action_link`. It points at GoTrue's
 * `/auth/v1/verify`, which redirects to the project's Site URL carrying the
 * session in the URL **fragment** (`#access_token=...`). A fragment is never
 * sent to a server, so a Route Handler cannot read it: `/auth/callback` looks
 * for `?code=`, finds nothing, and bounces to the login page. Verified against
 * staging, where Site URL is additionally still `http://localhost:3000` — so
 * the link sent somebody to their own device.
 *
 * Building it here against this app's own origin fixes all of that at once:
 * `/auth/confirm` exchanges the hash server-side into HttpOnly cookies, the
 * destination does not depend on a dashboard setting, and the URL is short
 * enough to make a sparse, easily-scanned QR code.
 *
 * @param next Optional in-app path to land on. Omit to let `/auth/confirm`
 *   route by role, which is what both callers want — a rider to their run, an
 *   owner to their shop.
 */
export async function setupLinkFor(tokenHash: string, next?: string): Promise<string | null> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return null

  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const params = new URLSearchParams({ token_hash: tokenHash, type: 'magiclink' })
  if (next) params.set('next', next)

  return `${proto}://${host}/auth/confirm?${params.toString()}`
}
