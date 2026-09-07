import type { Metadata } from 'next'
import { shopCanUseCod } from '@/lib/shops/approval'
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
      .eq('is_active', true)
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

  if (!shop || !shopState) {
    return (
      <Alert tone="error" title="No shop set up">
        Your account has no active shop yet, so orders cannot be created. Ask the Mingalar Express
        office to register your pickup point, then{' '}
        <Link href="/shop/dashboard" className="underline">
          return to the dashboard
        </Link>
        .
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
    WHERE THE REGISTRATION BLOCK WENT.

    0034 let a shop register with no pickup pin, because two thirds of Yangon
    addresses do not geocode and the alternative was turning those merchants
    away on their first screen. `orders.pickup_lat/lng` are still NOT NULL --
    they are the rider's navigation target -- so the parcel is what cannot be
    created, not the account.

    Stated here rather than caught as a constraint violation after they have
    filled in a customer's name and address, and with the fix one tap away.
    `ShopSettingsForm` has the map and the locate button, so this is a
    two-minute detour rather than a phone call to the office.
  */
  if (shop.pickup_lat === null || shop.pickup_lng === null) {
    return (
      <Alert tone="warning" title="Add your pickup location first">
        <span className="block">
          We have your address but not the exact spot on the map, and a rider needs it to collect.
          Open Shop settings, tap the locate button while you are at the shop or move the pin, and
          save. You only do this once.
        </span>
        <Link
          href="/shop/settings"
          className={cn(buttonVariants({ size: 'sm' }), 'mt-3')}
        >
          Set my pickup location
        </Link>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('book.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('book.subtitle')}</p>
      </div>
      <OrderForm
        shop={{ ...shop, pickup_lat: shop.pickup_lat, pickup_lng: shop.pickup_lng }}
        areas={areas}
        codLocked={!shopCanUseCod(shopState)}
      />
    </div>
  )
}
