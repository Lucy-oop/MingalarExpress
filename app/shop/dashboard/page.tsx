import Link from 'next/link'
import { Store } from 'lucide-react'
import type { Metadata } from 'next'
import { requireShop } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { getShopDashboard } from '@/lib/orders/queries'
import { OrderTable } from '@/components/orders/order-table'
import { Kpi } from '@/components/admin/kpi'
import { Alert } from '@/components/ui/alert'
import { formatMmk } from '@/lib/utils'
import { ContactSupport } from '@/components/shared/contact-support'
import { getPublicSettings } from '@/lib/settings/public'
import { shopApprovalState, shopBlockedMessage } from '@/lib/shops/approval'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Dashboard' }

/**
 * Never cached. The figures below are money the shop is owed and parcels a rider
 * is holding; a stale copy of either is worse than a slower page.
 */
export const dynamic = 'force-dynamic'

export default async function ShopDashboardPage() {
  await requireShop()
  const locale = await getLocale()
  const t = translator(locale)
  const { shop, counts, codInTransit, recent } = await getShopDashboard()
  const { supportPhone } = await getPublicSettings()
  const state = shop
    ? shopApprovalState({
        isActive: shop.is_active,
        approvedAt: shop.approved_at,
        rejectedAt: shop.rejected_at,
      })
    : null
  const blocked = shop
    ? shopBlockedMessage({
        isActive: shop.is_active,
        approvedAt: shop.approved_at,
        rejectedAt: shop.rejected_at,
      })
    : null

  return (
    <div className="space-y-6">

      <div>
        <h1 className="text-xl font-semibold">{shop?.name ?? 'Your shop'}</h1>
        <p className="text-sm text-muted-foreground">
          {shop?.pickup_address ?? 'No pickup address set'}
        </p>
      </div>

      {/*
        Three different reasons a shop cannot trade, and they used to be one
        message. "No shop yet" now has something to DO about it -- the owner
        knows their own address better than the office does -- while waiting,
        rejected and suspended each say their own thing. See lib/shops/approval.
      */}
      {!shop ? (
        <Alert tone="warning" title={t('sd.notSetUp')}>
          <span className="block">
            Tell us your shop name, what you sell and where riders collect from. It takes a minute.
          </span>
          <Link href="/shop/setup" className={cn(buttonVariants({ size: 'sm' }), 'mt-3')}>
            <Store className="size-4" />
            Set up my shop
          </Link>
          {/* The button is the answer for most owners; the number is for the
              one whose address the map cannot find. */}
          <ContactSupport phone={supportPhone} moreLabel={t('contact.more')} className="mt-3 text-sm" />
        </Alert>
      ) : blocked ? (
        /*
          INFO WHILE AWAITING, WARNING WHEN STOPPED. Since 0031 an unreviewed
          shop is open for business — the notice tells them COD is still to
          come, and an amber alert on a working dashboard reads as a fault.
          A suspended or rejected shop genuinely cannot trade, and keeps the
          warning.
        */
        <Alert tone={state === 'awaiting' ? 'info' : 'warning'} title={t('sd.awaiting')}>
          <span className="block">{blocked}</span>
          <ContactSupport phone={supportPhone} moreLabel={t('contact.more')} className="mt-2 text-sm" />
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
          label={t('sd.waiting')}
          value={counts.pending}
          href="/shop/orders?status=pending"
          tone={counts.pending > 0 ? 'warn' : 'default'}
        />
        <Kpi
          label={t('sd.onTheWay')}
          value={counts.inFlight}
          href="/shop/orders?status=assigned"
          hint={t('sd.onTheWayHint')}
        />
        <Kpi
          label={t('sd.codInTransit')}
          value={formatMmk(codInTransit)}
          hint={t('sd.codInTransitHint')}
          tone={codInTransit > 0 ? 'warn' : 'default'}
        />
        <Kpi label={t('sd.delivered')} value={counts.delivered} href="/shop/orders?status=delivered" />
        {/*
          Points at the parcels waiting on the SHOP, not at every failure. A
          parcel that failed while its run is still out is dispatch's problem
          and there is nothing for the shop to do about it yet.
        */}
        <Kpi
          label={t('sd.needsYou')}
          value={counts.needsDecision}
          href="/shop/orders?needs=1"
          hint={counts.failed > counts.needsDecision ? `${counts.failed} failed in total` : 'Retry, return or cancel'}
          tone={counts.needsDecision > 0 ? 'bad' : 'default'}
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t('sd.recent')}</h2>
          <Link href="/shop/orders" className="text-sm text-primary hover:underline">
            View all {counts.total > 0 ? `(${counts.total})` : null}
          </Link>
        </div>
        <OrderTable orders={recent} grouped={false} />
      </section>
    </div>
  )
}
