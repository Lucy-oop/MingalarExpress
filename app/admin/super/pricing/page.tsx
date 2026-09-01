import type { Metadata } from 'next'
import { getPricingSettings } from '@/lib/admin/queries'
import { PageHeader } from '@/components/admin/kpi'
import { PricingForm } from '@/components/admin/pricing-form'
import type { AppSettings } from '@/types/domain'

export const metadata: Metadata = { title: 'Pricing · Super Admin' }
export const dynamic = 'force-dynamic'

export default async function PricingPage() {
  const settings = (await getPricingSettings()) as AppSettings

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pricing & commission"
        description="Delivery fee tiers and the rider / platform split. Every change is written to the audit log by a database trigger."
      />
      <PricingForm settings={settings} />
    </div>
  )
}
