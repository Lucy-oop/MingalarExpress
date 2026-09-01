import type { Metadata } from 'next'
import { getServiceAreas } from '@/lib/admin/queries'
import { getShopList } from '@/lib/admin/shop-queries'
import { PageHeader } from '@/components/admin/kpi'
import { ShopManager } from '@/components/admin/shop-manager'

export const metadata: Metadata = { title: 'Shops · Super Admin' }
export const dynamic = 'force-dynamic'

export default async function AdminShopsPage() {
  const [data, areas] = await Promise.all([getShopList(), getServiceAreas()])

  // Owners who signed up but were never onboarded. Derived from the same fetch
  // rather than re-querying — the list already computed exactly this.
  const owners = data.rows
    .filter((r) => r.status === 'pending')
    .map((r) => ({ id: r.ownerId, fullName: r.ownerName, phone: r.ownerPhone }))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shops"
        description="Registration, approval and account status for every shop Mingalar Express delivers for. Suspending a shop also blocks its owner's login when it is their only one."
      />
      <ShopManager data={data} areas={areas} owners={owners} />
    </div>
  )
}
