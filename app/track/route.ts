import { NextResponse, type NextRequest } from 'next/server'

/**
 * The landing page posts a tracking code as `?code=`; turn that into the
 * canonical /track/CODE URL so the result is shareable and bookmarkable.
 */
export function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')?.trim().toUpperCase()
  const origin = request.nextUrl.origin
  if (!code) return NextResponse.redirect(`${origin}/`)
  return NextResponse.redirect(`${origin}/track/${encodeURIComponent(code)}`)
}
