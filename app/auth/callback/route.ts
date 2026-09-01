import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ROLE_HOME } from '@/lib/auth/guards'

/**
 * Email-confirmation / magic-link landing. Exchanges the code for a session,
 * then routes by role so nobody ever sees a generic "you are logged in" page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=missing_code`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/auth/login?error=link_expired`)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', data.user.id)
    .single()

  if (!profile?.is_active) {
    return NextResponse.redirect(`${origin}/auth/login?error=account_disabled`)
  }

  // Only allow same-app relative destinations.
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : ROLE_HOME[profile.role]
  return NextResponse.redirect(`${origin}${dest}`)
}
