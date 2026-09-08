import type { Metadata } from 'next'
import { shopBlockedCopy, shopCanUseCod, shopUsable } from '@/lib/shops/approval'
import Link from 'next/link'
import { requireShop } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'
import { getAreaRoutes } from '@/lib/orders/queries'
import { OrderForm } from '@/components/orders/order-form'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'New order' }

export default async function NewOrderPage() {
  await requireShop()
  const [supabase, locale] = await Promise.all([createClient(), getLocale()])
  const t = translator(locale)

  const [{ data: shop }, areas] = await Promise.all([
    supabase
      .from('shops')
      .select('id, name, pickup_address, pickup_lat, pickup_lng, is_active, approved_at, rejected_at')
      /*
        NO is_active FILTER, matching `createOrder`. It used to be here, and
        `lib/orders/actions.ts` says exactly why it should not be: "a filtered-
        away row reads as 'you have no shop', which is a fourth thing that is
        not true." A suspended shop was told its account had no shop at all --
        and sent to ring the office about registering a pickup point it already
        had. The blocked notice below names the real reason.

        It also made the two disagree for an owner with more than one shop: the
        page rendered against their oldest ACTIVE shop while the submit resolved
        their oldest shop full stop.
      */
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    // Areas arrive with the ZONE that prices them and the route that carries
    // them. An area missing either is not returned at all — the shop could not
    // be quoted for it, so offering it would only produce a rejected
    // submission.
    getAreaRoutes(),
  ])

  /*
    The approval state, for the COD lock. `shopCanUseCod` is the single home for
    the rule; `tg_orders_shop_gate` enforces it in SQL. This only stops a shop
    typing an amount it is not allowed to collect and being refused afterwards.
  */
  const shopState = shop
    ? { isActive: shop.is_active, approvedAt: shop.approved_at, rejectedAt: shop.rejected_at }
    : null

  /*
    GENUINELY NO SHOP, which since the is_active filter came off is the only way
    to land here. The old copy sent them to the office to have a pickup point
    registered for them; /shop/setup has been self-service since 0026 and they
    know their own address better than the office does.
  */
  if (!shop || !shopState) {
    return (
      <Alert tone="warning" title={t('shop.noShop.title')}>
        <span className="block">{t('shop.noShop.body')}</span>
        <Link href="/shop/setup" className={cn(buttonVariants({ size: 'sm' }), 'mt-3')}>
          {t('sd.notSetUp')}
        </Link>
      </Alert>
    )
  }

  /*
    SUSPENDED OR REJECTED, now reachable because the query no longer hides it.
    `shopUsable` admits `awaiting` -- that shop trades prepaid -- so this catches
    only the two states that really cannot book, and says which.
  */
  const blocked = shopBlockedCopy(shopState)
  if (blocked && !shopUsable(shopState)) {
    return (
      <Alert tone={blocked.tone} title={t(blocked.title)}>
        <span className="block">{t(blocked.body)}</span>
      </Alert>
    )
  }

  // The real precondition now that pricing comes from the routes. This used to
  // check `app_settings`, which no longer sets the fee — a shop could reach a
  // form that was unable to price anything and be told pricing was fine.
  if (areas.length === 0) {
    return (
      <Alert tone="error" title="No delivery areas configured">
        No service area is mapped to a route yet, so an order cannot be priced or dispatched. Ask
        the Mingalar Express office to map the areas you deliver to.
      </Alert>
    )
  }

  /*
    NO PIN GATE HERE ANY MORE.

    0034 let a shop register without a map pin, and this page then refused to
    book for it -- the block had moved, not gone. But a merchant whose street
    the geocoder cannot find could still not sell anything, which is the same
    dead end one screen later. 0036 made `orders.pickup_lat/lng` nullable, so
    the parcel is created and the rider works from the address, the pickup note
    and the shop's phone.

    What the rider loses is the Directions link, and only that. `sortRoute`
    already sorts an unmeasurable stop to the end of its own group rather than
    dropping it, and `planCollections` already renders a group with no point
    without a map link rather than with a wrong one -- both written for bad
    data, both now with a legitimate case.
  */

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('book.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('book.subtitle')}</p>
      </div>
      {/* The coordinates may be null; `OrderForm` takes them that way now, so
          the spread no longer needs narrowing to get past the type. */}
      <OrderForm shop={shop} areas={areas} codLocked={!shopCanUseCod(shopState)} />
    </div>
  )
}
