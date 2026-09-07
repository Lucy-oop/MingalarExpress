import type { Metadata } from 'next'
import { requireShop } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
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
  const locale = await getLocale()
  const t = translator(locale)
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
      <Alert tone="error" title={t('sm.unavailable')}>
        {error instanceof Error ? error.message : 'Unknown error'}
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('sm.title')}
        description={t('sm.subtitle')}
      />

      <MoneyRange from={from} to={to} today={today} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label={t('sd.delivered')} value={money.delivered} hint={`${from} to ${to}`} />
        <Kpi label={t('sm.inTransit')} value={money.inTransit} hint={t('sm.inTransitHint')} />
        <Kpi label={t('sm.collected')} value={formatMmk(money.codCollected)} />
        <Kpi label={t('sm.fees')} value={formatMmk(money.platformFees)} hint={t('sm.feesHint')} />
        <Kpi
          label={t('sm.owed')}
          value={formatMmk(money.owedToShop)}
          tone={money.owedToShop > 0 ? 'good' : 'default'}
          hint={t('sm.owedHint')}
        />
      </div>

      {/* Only when there is a shortfall. A row of zeroes on every shop's page
          would teach everyone to ignore the one time it matters. */}
      {money.codUnreceived > 0 ? (
        <Alert tone="warning" title={t('sm.notReceived', { amount: formatMmk(money.codUnreceived) })}>
          These parcels were delivered, but the payment has not reached us — either a
          KBZPay transfer we are still checking against the bank, or one that did not
          match. Until it arrives it is not counted in{' '}
          <strong>COD collected</strong> or in <strong>owed to you</strong>, and the
          delivery fee on those parcels is still due. The office will be in touch about
          any that do not clear.
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{t('sm.howWorked')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The rider collects <strong>{formatMmk(money.codCollected)}</strong> at the door on your
            delivered COD parcels. Of that,{' '}
            <strong>{formatMmk(money.goodsValue)}</strong> is the value of your goods and{' '}
            <strong>{formatMmk(money.platformFees)}</strong> is Mingalar Express&rsquo;s delivery
            fee, leaving <strong>{formatMmk(money.owedToShop)}</strong> owed to you.
          </p>
          {money.codUnreceived > 0 ? (
            <p>
              A delivered parcel whose payment never arrived counts as neither: the fee is
              still earned because the parcel was carried, so it is deducted, and nothing
              is added. That is why{' '}
              <strong>{formatMmk(money.codUnreceived)}</strong> appears above the figures
              rather than inside them.
            </p>
          ) : null}
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
        <OrderTable orders={delivered.rows} locale={locale} />
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
