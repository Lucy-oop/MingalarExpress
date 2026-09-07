import type { Metadata } from 'next'
import { getPricingSettings } from '@/lib/admin/queries'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/kpi'
import { PricingForm, type RoutePreview } from '@/components/admin/pricing-form'
import { MIN_PARCELS_PER_TRIP, type RoutePayTier } from '@/lib/pricing'
import { planningFeeByRoute } from '@/lib/routes/planning-fee'
import type { AppSettings } from '@/types/domain'

export const metadata: Metadata = { title: 'Pricing · Super Admin' }
export const dynamic = 'force-dynamic'

export default async function PricingPage() {
  const supabase = await createClient()

  /*
    The preview costs each route at the minimum-volume run, so it needs the pay
    tiers and per-unit rates as well as the fees. Trip pay makes margin a
    RESIDUAL rather than a percentage — the fee alone cannot say whether a route
    makes money.

    The revenue side comes from the ZONES the route serves, not from
    `routes.per_parcel_fee`, which stopped being what anyone is billed when 0033
    moved the customer price to the destination area's zone. `planningFeeByRoute`
    carries the reasoning, including why it takes the lowest of several bands.
  */
  const [settings, { data: routeRows }, { data: tierRows }, { data: areaRows }] =
    await Promise.all([
      getPricingSettings() as Promise<AppSettings>,
      supabase
        .from('routes')
        .select('id, code, name, colour, per_parcel_fee')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase.from('route_pay_tiers').select('id, route_id, min_parcels, max_parcels, base_pay'),
      supabase
        .from('route_areas')
        .select('route_id, is_primary, service_areas:area_id (delivery_zones:zone_id (fee))')
        .eq('is_primary', true),
    ])

  const zoneFee = planningFeeByRoute(areaRows ?? [])

  const routes: RoutePreview[] = (routeRows ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    colour: r.colour,
    // Falls back to the route's own figure only for a route serving no primary
    // area — nothing can be dispatched to one of those anyway.
    perParcelFee: zoneFee.get(r.id) ?? Number(r.per_parcel_fee),
  }))

  const tiers: RoutePayTier[] = (tierRows ?? []).map((t) => ({
    routeId: t.route_id,
    minParcels: t.min_parcels,
    maxParcels: t.max_parcels,
    basePay: Number(t.base_pay),
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pricing & commission"
        description="The rider / platform split for per-parcel jobs, and the flat route fees shops are charged. Every change is written to the audit log by a database trigger."
      />
      <PricingForm
        settings={settings}
        routes={routes}
        tiers={tiers}
        rates={{
          parcelRate: Number(settings.route_parcel_rate ?? 300),
          pickupRate: Number(settings.route_pickup_rate ?? 500),
        }}
        minParcels={Number(settings.min_parcels_per_trip ?? MIN_PARCELS_PER_TRIP)}
      />
    </div>
  )
}
