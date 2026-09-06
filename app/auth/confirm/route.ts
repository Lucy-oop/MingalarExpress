import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { ROLE_HOME } from '@/lib/auth/guards'

/**
 * Token-hash landing, for links this app mints itself.
 *
 * WHY THIS EXISTS ALONGSIDE /auth/callback, which looks like it does the same
 * job. It does not, and the difference is the whole reason a rider setup link
 * could not work without it:
 *
 *   /auth/callback  reads `?code=` -- the PKCE flow, used when the BROWSER
 *                   started the sign-in and holds the code verifier. Correct
 *                   for email confirmation after signup.
 *
 *   /auth/confirm   reads `?token_hash=` -- for a link minted SERVER-side by
 *                   `auth.admin.generateLink`. There is no browser in that
 *                   story and so no code verifier.
 *
 * Handing out `generateLink`'s own `action_link` instead sends the user to
 * GoTrue's `/auth/v1/verify`, which redirects to the project's Site URL with
 * the session in the URL **fragment** (`#access_token=...`). A fragment is
 * never sent to a server, so a Route Handler cannot see it -- `/auth/callback`
 * would find no `code` and bounce to the login page. Verified against staging:
 * that is exactly what happens.
 *
 * Minting our own URL also means the QR encodes THIS app's domain rather than
 * the Supabase project's, so it does not depend on the Site URL setting being
 * right, it is shorter (a denser QR is a harder scan), and the session lands in
 * HttpOnly cookies rather than in a URL that sits in browser history.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = (searchParams.get('type') ?? 'magiclink') as EmailOtpType
  const next = searchParams.get('next')

  if (!tokenHash) {
    return NextResponse.redirect(`${origin}/auth/login?error=missing_code`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/auth/login?error=link_expired`)
  }

  // Same gate as /auth/callback. A held or suspended rider is refused here even
  // though `createRiderSetupLink` already refuses to mint for one — the account
  // can be suspended in the minutes between the QR appearing and being scanned.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', data.user.id)
    .single()

  if (!profile?.is_active) {
    return NextResponse.redirect(`${origin}/auth/login?error=account_disabled`)
  }

  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : ROLE_HOME[profile.role]
  return NextResponse.redirect(`${origin}${dest}`)
}
