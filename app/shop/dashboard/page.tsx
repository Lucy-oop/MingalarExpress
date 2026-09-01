import Link from 'next/link'
import type { Metadata } from 'next'
import { PackagePlus } from 'lucide-react'
import { requireShop } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { OrderTable } from '@/components/orders/order-table'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { formatMmk } from '@/lib/utils'
import type { OrderStatus } from '@/types/domain'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function ShopDashboardPage() {
  await requireShop()
  const supabase = await createClient()

  // RLS scopes both queries to this shop. No shop_id filter is needed, and
  // adding one would imply the filter is what protects the data. It is not.
  const [{ data: shop }, { data: orders }] = await Promise.all([
    supabase.from('shops').select('id, name, pickup_address').limit(1).maybeSingle(),
    supabase
      .from('orders')
      .select(
        'id, code, status, customer_name, customer_phone, dropoff_address, cod_amount, delivery_fee, payment_method, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const rows = orders ?? []
  const openStatuses: OrderStatus[] = ['pending', 'assigned', 'picked_up']
  const open = rows.filter((o) => openStatuses.includes(o.status))
  const delivered = rows.filter((o) => o.status === 'delivered')
  const codOutstanding = open
    .filter((o) => o.payment_method === 'cod')
    .reduce((sum, o) => sum + o.cod_amount, 0)

  return (
    <div className="space-y-6">
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

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Open deliveries" value={String(open.length)} />
        <Stat label="Delivered (last 10)" value={String(delivered.length)} />
        <Stat label="COD in transit" value={formatMmk(codOutstanding)} />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Recent orders</h2>
          <Link href="/shop/orders" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        <OrderTable orders={rows} />
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}
