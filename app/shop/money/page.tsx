import type { Metadata } from 'next'
import { requireShop } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { getShopAccount, getShopMoney, searchShopOrders } from '@/lib/orders/queries'
import { PAYOUT_METHOD_LABEL, isPayoutMethod } from '@/lib/shops/payout'
import { isoDaysAgo, yangonToday } from '@/lib/admin/day'
import { MoneyRange } from '@/components/orders/money-range'
import { OrderTable } from '@/components/orders/order-table'
import { PageHeader } from '@/components/admin/kpi'
import { ShopMoneyCard, ShopStatTile } from '@/components/shop/shop-stats'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { formatDateTimeYangon, formatMmk } from '@/lib/utils'

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
  let account
  try {
    ;[money, delivered, account] = await Promise.all([
      getShopMoney(from, to),
      searchShopOrders({ status: 'delivered', from, to, pageSize: 50 }),
      getShopAccount(),
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

      {/*
        0056: THE ACCOUNT, FIRST. All time, from the payout ledger: what was
        collected for the shop's goods, what was deducted, what we have paid,
        and what is available now. This is the answer to "what do you owe me";
        the date-range figures below are the working, not the balance.
      */}
      <section className="space-y-3" aria-labelledby="account-title">
        <div>
          <h2 id="account-title" className="font-semibold">{t('sm.accountTitle')}</h2>
          <p className="text-xs text-muted-foreground">{t('sm.accountHint')}</p>
        </div>
        <ShopMoneyCard
          label={t('sm.available')}
          value={formatMmk(account.available)}
          hint={t('sm.availableHint')}
          tone={account.available > 0 ? 'good' : 'default'}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ShopStatTile label={t('sm.goodsCollected')} value={formatMmk(account.goodsCollected)} />
          <ShopStatTile label={t('sm.feesDeducted')} value={formatMmk(account.feesDeducted)} />
          <ShopStatTile label={t('sm.paidOut')} value={formatMmk(account.paidOut)} />
          <ShopStatTile
            label={t('sm.pending')}
            value={formatMmk(account.pendingClearance)}
            hint={t('sm.pendingHint')}
          />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t('sm.payouts')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {account.payouts.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted-foreground">{t('sm.noPayouts')}</p>
            ) : (
              <ul className="divide-y border-t">
                {account.payouts.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {p.method && isPayoutMethod(p.method)
                          ? PAYOUT_METHOD_LABEL[p.method][locale]
                          : p.method ?? '—'}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDateTimeYangon(p.createdAt)}
                        {p.reference ? ` · ${t('sm.ref')} ${p.reference}` : ''}
                        {p.memo ? ` · ${p.memo}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatMmk(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <h2 className="pt-2 font-semibold">{t('sm.periodTitle')}</h2>
      <MoneyRange from={from} to={to} today={today} />

      {/*
        THE ANSWER FIRST. This was five admin `Kpi` tiles two-across — the same
        desk density the dashboard carried, and the same failure: three of the
        five are money, and a comma-grouped MMK total is one unbreakable token
        that renders through a 126px tile's border. See the docblock on
        components/shop/shop-stats.

        "Owed to you" is what a shop opens this page to find out, so it takes
        the full width and the good tone. Collected and fees are the working
        that produces it and sit under it as a pair; the two counts follow. At
        `lg` the five go back to one row, unchanged.
      */}
      <div className="space-y-3 lg:grid lg:grid-cols-5 lg:gap-3 lg:space-y-0">
        <div className="lg:order-5">
          <ShopMoneyCard
            label={t('sm.owed')}
            value={formatMmk(money.owedToShop)}
            hint={t('sm.owedHint')}
            tone={money.owedToShop > 0 ? 'good' : 'default'}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:contents">
          <div className="lg:order-3">
            <ShopStatTile label={t('sm.collected')} value={formatMmk(money.codCollected)} />
          </div>
          <div className="lg:order-4">
            <ShopStatTile
              label={t('sm.fees')}
              value={formatMmk(money.platformFees)}
              hint={t('sm.feesHint')}
            />
          </div>
          <div className="lg:order-1">
            <ShopStatTile
              label={t('sd.delivered')}
              value={money.delivered}
              hint={`${from} to ${to}`}
            />
          </div>
          <div className="lg:order-2">
            <ShopStatTile
              label={t('sm.inTransit')}
              value={money.inTransit}
              hint={t('sm.inTransitHint')}
            />
          </div>
        </div>
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
            0056: these range figures are the WORKING. The balance and the
            payout history -- the statement -- are in the account section at
            the top, backed by the append-only shop_ledger.
          */}
          <p className="rounded-md border bg-muted/40 p-2.5 text-xs">
            These date-range totals are worked out from your orders. Your balance and every payout
            we have made are in <strong>Your account with Mingalar Express</strong> above.
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
