import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { quoteRequestSchema } from '@/lib/validation/schemas'
import { haversineKm } from '@/lib/geo/haversine'
import { quoteFee, splitCommission } from '@/lib/pricing'

/**
 * Live fee quote for the order form.
 *
 * Authenticated: the pricing table is not public, and an open endpoint would let
 * anyone enumerate the fee curve. Settings are read through the caller's RLS
 * session (app_settings is readable by any authenticated user).
 *
 * This is advisory only -- the authoritative fee is whatever is written to
 * orders.delivery_fee by the server action, which recomputes it. Never trust a
 * fee that arrived from the browser.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = quoteRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const { data: settings, error } = await supabase
    .from('app_settings')
    .select('base_delivery_fee, per_km_fee, free_km, road_factor, rider_commission_pct')
    .eq('id', true)
    .single()

  if (error || !settings) {
    return NextResponse.json({ error: 'settings_unavailable' }, { status: 503 })
  }

  const crowKm = haversineKm(parsed.data.pickup, parsed.data.dropoff)
  const quote = quoteFee(crowKm, settings)
  const split = splitCommission(quote.total, Number(settings.rider_commission_pct))

  return NextResponse.json(
    { quote, split },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
