import Link from 'next/link'
import type { Metadata } from 'next'
import { PackagePlus } from 'lucide-react'
import { requireShop } from '@/lib/auth/guards'
import { getShopDashboard } from '@/lib/orders/queries'
import { OrderTable } from '@/components/orders/order-table'
import { ShopLiveRefresh } from '@/components/orders/shop-live-refresh'
import { Kpi } from '@/components/admin/kpi'
import { buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { formatMmk } from '@/lib/utils'

export const metadata: Metadata = { title: 'Dashboard' }

/**
 * Never cached. The figures below are money the shop is owed and parcels a rider
 * is holding; a stale copy of either is worse than a slower page.
 */
export const dynamic = 'force-dynamic'

export default async function ShopDashboardPage() {
  await requireShop()
  const { shop, counts, codInTransit, recent } = await getShopDashboard()

  return (
    <div className="space-y-6">
      <ShopLiveRefresh />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{shop?.name ?? 'Your shop'}</h1>
          <p className="text-sm text-muted-foreground">
            {shop?.pickup_address ?? 'No pickup address set'}
          </p>
        </div>
        <Link href="/shop/orders/new" className={buttonVariants()}>
          <PackagePlus className="size-4" />
          New order
        </Link>
      </div>

      {!shop ? (
        <Alert tone="error" title="Shop not set up">
          Your account has no shop yet. Ask the Mingalar Express office to add your pickup point.
        </Alert>
      ) : null}

      {/*
        Every figure here is a server-side aggregate over the shop's whole order
        history. They used to be counted in JS over the ten most recent rows,
        which quietly undercounted any shop busier than that — "COD in transit"
        included, which is real money.
      */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi
          label="Waiting for a rider"
          value={counts.pending}
          href="/shop/orders?status=pending"
          tone={counts.pending > 0 ? 'warn' : 'default'}
        />
        <Kpi
          label="On the way"
          value={counts.inFlight}
          href="/shop/orders?status=assigned"
          hint="Assigned or picked up"
        />
        <Kpi
          label="COD in transit"
          value={formatMmk(codInTransit)}
          hint="Cash riders are holding"
          tone={codInTransit > 0 ? 'warn' : 'default'}
        />
        <Kpi label="Delivered" value={counts.delivered} href="/shop/orders?status=delivered" />
        <Kpi
          label="Needs attention"
          value={counts.failed}
          href="/shop/orders?status=failed"
          hint="Failed delivery"
          tone={counts.failed > 0 ? 'bad' : 'default'}
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Recent orders</h2>
          <Link href="/shop/orders" className="text-sm text-primary hover:underline">
            View all {counts.total > 0 ? `(${counts.total})` : null}
          </Link>
        </div>
        <OrderTable orders={recent} />
      </section>
    </div>
  )
}
