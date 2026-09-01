import type { Metadata } from 'next'
import Link from 'next/link'
import { requireShop } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { OrderForm } from '@/components/orders/order-form'
import { Alert } from '@/components/ui/alert'

export const metadata: Metadata = { title: 'New order' }

export default async function NewOrderPage() {
  await requireShop()
  const supabase = await createClient()

  const [{ data: shop }, { data: areas }, { data: settings }] = await Promise.all([
    supabase
      .from('shops')
      .select('id, name, pickup_address, pickup_lat, pickup_lng')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('service_areas')
      .select('id, name, name_mm')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('app_settings')
      .select('base_delivery_fee, per_km_fee, free_km, road_factor, rider_commission_pct')
      .eq('id', true)
      .single(),
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

  if (!settings) {
    return (
      <Alert tone="error" title="Pricing unavailable">
        Delivery pricing could not be loaded. Please try again in a moment.
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">New delivery order</h1>
        <p className="text-sm text-muted-foreground">
          Sending from <span className="font-medium">{shop.name}</span>. Delivery is available inside
          Thingangyun Township only.
        </p>
      </div>
      <OrderForm shop={shop} areas={areas ?? []} settings={settings} />
    </div>
  )
}
