import type { Metadata } from 'next'
import { requireShop } from '@/lib/auth/guards'
import { getShopMoney, searchShopOrders } from '@/lib/orders/queries'
import { isoDaysAgo, yangonToday } from '@/lib/admin/day'
import { MoneyRange } from '@/components/orders/money-range'
import { OrderTable } from '@/components/orders/order-table'
import { Kpi, PageHeader } from '@/components/admin/kpi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { formatMmk } from '@/lib/utils'

export const metadata: Metadata = { title: 'Money' }
export const dynamic = 'force-dynamic'

const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

export default async function ShopMoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  await requireShop()
  const sp = await searchParams

  const today = yangonToday()
  const from = isDate(sp.from) ? sp.from : isoDaysAgo(today, 30)
  const to = isDate(sp.to) ? sp.to : today

  let money
  let delivered
  try {
    ;[money, delivered] = await Promise.all([
      getShopMoney(from, to),
      searchShopOrders({ status: 'delivered', from, to, pageSize: 50 }),
    ])
  } catch (error) {
    return (
      <Alert tone="error" title="Money summary unavailable">
        {error instanceof Error ? error.message : 'Unknown error'}
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Money"
        description="Cash collected on your behalf and what it nets out to, over a date range."
      />

      <MoneyRange from={from} to={to} today={today} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Delivered" value={money.delivered} hint={`${from} to ${to}`} />
        <Kpi label="Still in transit" value={money.inTransit} hint="Not yet collected" />
        <Kpi label="COD collected" value={formatMmk(money.codCollected)} />
        <Kpi label="Delivery fees" value={formatMmk(money.platformFees)} hint="Mingalar's share" />
        <Kpi
          label="Owed to you"
          value={formatMmk(money.owedToShop)}
          tone={money.owedToShop > 0 ? 'good' : 'default'}
          hint="Goods value, fees deducted"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">How this is worked out</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The rider collects <strong>{formatMmk(money.codCollected)}</strong> at the door on your
            delivered COD parcels. Of that,{' '}
            <strong>{formatMmk(money.goodsValue)}</strong> is the value of your goods and{' '}
            <strong>{formatMmk(money.platformFees)}</strong> is Mingalar Express&rsquo;s delivery
            fee, leaving <strong>{formatMmk(money.owedToShop)}</strong> owed to you.
          </p>
          {/*
            Said plainly, because it is the difference between a report and a
            statement. These figures are recomputed from your orders every time
            this page loads: there is no shop-side ledger, so nothing here can
            show a payment that has already been made, a part-payment, or a
            disputed amount. Presenting it as an account would be a lie.
          */}
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
            These totals are calculated from your orders each time this page opens. They are not a
            statement of account and do not show payouts already made — the office holds the
            record of what has actually been paid.
          </p>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="font-semibold">
          Delivered in this range{' '}
          <span className="text-sm font-normal text-muted-foreground">
            ({delivered.total.toLocaleString()})
          </span>
        </h2>
        <OrderTable orders={delivered.rows} />
        {delivered.total > delivered.rows.length ? (
          <p className="text-xs text-muted-foreground">
            Showing the {delivered.rows.length} most recent. Use Orders for the full list and CSV
            export.
          </p>
        ) : null}
      </section>
    </div>
  )
}
