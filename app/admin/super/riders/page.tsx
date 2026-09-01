import type { Metadata } from 'next'
import { getPricingSettings, getRiders, getServiceAreas } from '@/lib/admin/queries'
import { PageHeader } from '@/components/admin/kpi'
import { RiderRegisterForm } from '@/components/admin/rider-register-form'
import { RiderRoster } from '@/components/admin/rider-roster'

export const metadata: Metadata = { title: 'Riders · Super Admin' }
export const dynamic = 'force-dynamic'

export default async function RidersPage() {
  const [riders, areas, settings] = await Promise.all([
    getRiders(),
    getServiceAreas(),
    getPricingSettings(),
  ])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Riders"
        description="Registration, approval and the operating parameters dispatch scores on. Riders cannot self-register — public signup can only ever create a shop account."
      />

      <RiderRegisterForm
        areas={areas}
        defaultCoverageKm={Number(settings.default_coverage_km)}
      />

      <RiderRoster
        riders={riders}
        areas={areas}
        globalCommissionPct={Number(settings.rider_commission_pct)}
      />
    </div>
  )
}
