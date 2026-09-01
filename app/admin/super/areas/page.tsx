import type { Metadata } from 'next'
import { getPricingSettings, getServiceAreas } from '@/lib/admin/queries'
import { PageHeader } from '@/components/admin/kpi'
import { AreaManager } from '@/components/admin/area-manager'
import { CoverageForm } from '@/components/admin/coverage-form'
import type { AppSettings } from '@/types/domain'

export const metadata: Metadata = { title: 'Coverage · Super Admin' }
export const dynamic = 'force-dynamic'

export default async function CoveragePage() {
  const [areas, settings] = await Promise.all([
    getServiceAreas(),
    getPricingSettings() as Promise<AppSettings>,
  ])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Coverage & base location"
        description="The served box, where every map opens, and the wards Mingalar Express delivers to."
      />
      <CoverageForm settings={settings} />
      <AreaManager areas={areas} />
    </div>
  )
}
