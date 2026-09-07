import type { Metadata } from 'next'
import { requireShop } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { getShopNotifications } from '@/lib/orders/queries'
import { NotificationFeed } from '@/components/orders/notification-feed'

export const metadata: Metadata = { title: 'Updates' }
export const dynamic = 'force-dynamic'

/**
 * What has happened to this shop's parcels.
 *
 * NOT A NOTIFICATION SYSTEM, and the distinction is the reason this exists at
 * all. 0014 built an SMS outbox and 0016 removed it: the office rings a shop
 * when something needs deciding, and `docs/ARCHITECTURE.md` records automated
 * messaging as a non-goal. Nothing here sends anything. It is a page a shop
 * reads when it opens the app, derived entirely from `order_status_events`, so
 * there is no second write path to drift from the parcels themselves.
 *
 * LIVE FOR FREE. `shop-parcel-alert` already holds a `shop-parcels:${userId}`
 * realtime channel on every shop page, debounced into `router.refresh()`, and
 * every status event is written alongside an `orders` UPDATE. Combined with
 * `force-dynamic` this page updates itself with no new socket — which its own
 * docblock is explicit about not opening.
 */
export default async function ShopNotificationsPage() {
  const { userId } = await requireShop()
  const locale = await getLocale()
  const t = translator(locale)
  const groups = await getShopNotifications()

  return (
    <div className="space-y-4" lang={locale}>
      <div>
        <h1 className="text-xl font-semibold">{t('sn.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('sn.hint')}</p>
      </div>
      <NotificationFeed groups={groups} userId={userId} />
    </div>
  )
}
