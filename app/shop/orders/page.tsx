import type { Metadata } from 'next'
import { requireShop } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { OrderTable } from '@/components/orders/order-table'
import { Select } from '@/components/ui/select'
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/types/domain'

export const metadata: Metadata = { title: 'Orders' }

const STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]

function isStatus(v: string | undefined): v is OrderStatus {
  return !!v && (STATUSES as string[]).includes(v)
}

export default async function ShopOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await requireShop()
  const { status } = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('orders')
    .select(
      'id, code, status, customer_name, customer_phone, dropoff_address, cod_amount, delivery_fee, payment_method, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (isStatus(status)) query = query.eq('status', status)

  const { data: orders } = await query

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Orders</h1>
        <form className="flex items-center gap-2">
          <label htmlFor="status" className="text-sm text-muted-foreground">
            Status
          </label>
          <Select id="status" name="status" defaultValue={status ?? ''} className="w-44">
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <button
            type="submit"
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Filter
          </button>
        </form>
      </div>
      <OrderTable orders={orders ?? []} />
    </div>
  )
}
