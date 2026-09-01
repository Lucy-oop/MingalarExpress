import type { Metadata } from 'next'
import Link from 'next/link'
import { requireShop } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { getAreaRoutes } from '@/lib/orders/queries'
import { OrderForm } from '@/components/orders/order-form'
import { Alert } from '@/components/ui/alert'

export const metadata: Metadata = { title: 'New order' }

export default async function NewOrderPage() {
  await requireShop()
  const supabase = await createClient()

  const [{ data: shop }, areas] = await Promise.all([
    supabase
      .from('shops')
      .select('id, name, pickup_address, pickup_lat, pickup_lng')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    // Areas arrive with the route that prices them. An area with no primary
    // route is not returned at all — the shop could not be quoted for it, so
    // offering it would only produce a rejected submission.
    getAreaRoutes(),
  ])

  if (!shop) {
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">New delivery order</h1>
        <p className="text-sm text-muted-foreground">
          Sending from <span className="font-medium">{shop.name}</span>. Delivery is available
          across Greater Yangon on the daily routes, and the destination area sets the fee.
        </p>
      </div>
      <OrderForm shop={shop} areas={areas} />
    </div>
  )
}
