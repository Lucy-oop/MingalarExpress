import type { Metadata } from 'next'
import { getDeliveryZones, getPricingSettings, getServiceAreas, getZoneChoices } from '@/lib/admin/queries'
import { PageHeader } from '@/components/admin/kpi'
import { AreaManager } from '@/components/admin/area-manager'
import { ZoneManager } from '@/components/admin/zone-manager'
import { CoverageForm } from '@/components/admin/coverage-form'
import type { AppSettings } from '@/types/domain'

export const metadata: Metadata = { title: 'Coverage & rates · Super Admin' }
export const dynamic = 'force-dynamic'

/**
 * Coverage, rates and wards on one screen, in the order the office works in:
 * draw the box, set what each band costs, then say which band each ward is in.
 *
 * The rate card sits ABOVE the ward list deliberately — a ward cannot be saved
 * without a zone, so the zones have to exist first, and putting them second
 * would send an admin adding their first ward to a selector with nothing in it.
 */
export default async function CoveragePage() {
  const [areas, zones, zoneChoices, settings] = await Promise.all([
    getServiceAreas(),
    getDeliveryZones(),
    getZoneChoices(),
    getPricingSettings() as Promise<AppSettings>,
  ])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Coverage, rates & wards"
        description="The served box, what a shop pays to deliver into each zone, and the wards Mingalar Express covers."
      />
      <CoverageForm settings={settings} />
      <ZoneManager zones={zones} />
      <AreaManager areas={areas} zones={zoneChoices} />
    </div>
  )
}
