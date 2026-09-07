import type { Metadata } from 'next'
import { Coins, TrendingUp } from 'lucide-react'
import { requireRider } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import Link from 'next/link'
import { cn, formatDateTimeYangon, formatMmk } from '@/lib/utils'
import { formatDayHeader, groupByDay, isoDaysAgo, yangonToday } from '@/lib/time/day'
import { localeNumber } from '@/lib/i18n'

export const metadata: Metadata = { title: 'Earnings' }
export const dynamic = 'force-dynamic'

/** Presets rather than two date inputs: this is a phone, held one-handed. */
const RANGES = [7, 30, 90] as const
const PAGE = 200

export default async function RiderEarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  await requireRider()
  const [locale, supabase, sp] = await Promise.all([getLocale(), createClient(), searchParams])
  const t = translator(locale)

  const days = RANGES.find((d) => String(d) === sp.days) ?? 30
  const today = yangonToday()
  const from = isoDaysAgo(today, days - 1)

  /*
    All figures come from the ledger — the book of record — never recomputed
    from orders. RLS scopes both reads to this rider.

    A RANGE AND A COUNT, because this was `.limit(40)` with no footnote: a rider
    with a busy week simply lost the rest and was never told. `count: 'exact'`
    is what lets the page say so out loud.

    The +06:30 literal matches applyOrderFilters — Myanmar has no DST, so a
    fixed offset is exact rather than an approximation.
  */
  const [{ data: summary }, { data: ledger, count }] = await Promise.all([
    supabase.rpc('rider_earnings_summary'),
    supabase
      .from('cod_ledger')
      .select('id, kind, amount, memo, created_at, settlement_id', { count: 'exact' })
      .gte('created_at', `${from}T00:00:00+06:30`)
      .order('created_at', { ascending: false })
      .limit(PAGE),
  ])

  const s = (summary ?? {}) as Record<string, number | string | null>
  const codInHand = Number(s.cod_in_hand ?? 0)

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t('earnings.title')}</h1>

      <div className="grid grid-cols-2 gap-2">
        <Tile label={t('stat.earnedToday')} value={formatMmk(Number(s.earned_today ?? 0))} />
        <Tile label={t('earnings.week')} value={formatMmk(Number(s.earned_week ?? 0))} />
        <Tile label={t('stat.delivered')} value={String(s.delivered_today ?? 0)} />
        <Tile label={t('stat.collected')} value={String(s.picked_up_today ?? 0)} />
        <Tile label={t('earnings.activeJobs')} value={String(s.active_orders ?? 0)} />
      </div>

      <Card className={codInHand > 0 ? 'border-amber-300 bg-amber-50' : undefined}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Coins className="size-4" />
            Company cash you are holding
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold tabular-nums">{formatMmk(codInHand)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {codInHand > 0
              ? 'This is COD you have collected, less the commission you have earned. Hand it in at settlement.'
              : 'Nothing outstanding.'}
          </p>
          {s.unsettled_since ? (
            <p className="mt-1 text-xs text-amber-800">
              Unsettled since {formatDateTimeYangon(String(s.unsettled_since))}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="size-4" />
            Recent entries
          </h2>
          {/* URL-driven, like every other filter in this app, so a rider can
              reload without losing the range. */}
          <div className="flex gap-1" role="group">
            {RANGES.map((d) => (
              <Link
                key={d}
                href={`/rider/earnings?days=${d}`}
                aria-current={d === days ? 'page' : undefined}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium',
                  d === days ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted',
                )}
              >
                {t('earnings.days').replace('{n}', localeNumber(locale, d))}
              </Link>
            ))}
          </div>
        </div>
        {(ledger ?? []).length === 0 ? (
          <Alert tone="info">{t('earnings.empty')}</Alert>
        ) : (
          groupByDay(ledger ?? [], (r) => r.created_at).map((group) => (
          <section key={group.key} className="overflow-hidden rounded-lg border bg-card">
            {/* Same header shape as the dispatcher's area groups: bg-muted/40,
                text-xs font-semibold, count right-aligned and tabular. */}
            <header className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5">
              <span className="text-xs font-semibold">
                {formatDayHeader(group.key, today, locale)}
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {localeNumber(locale, group.rows.length)}
              </span>
            </header>
            <ul className="divide-y">
            {group.rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{LEDGER_LABEL[row.kind] ?? row.kind}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.memo ?? '—'} · {formatDateTimeYangon(row.created_at)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`text-sm font-semibold tabular-nums ${
                      row.amount < 0 ? 'text-emerald-700' : 'text-foreground'
                    }`}
                  >
                    {row.amount < 0 ? '+' : ''}
                    {formatMmk(Math.abs(row.amount))}
                  </p>
                  <p className="text-[10px] uppercase text-muted-foreground">
                    {row.settlement_id ? 'settled' : 'open'}
                  </p>
                </div>
              </li>
            ))}
            </ul>
          </section>
          ))
        )}
        {/* Said out loud. This was a bare .limit(40) with no footnote, so a
            busy rider lost the rest of their week without being told. */}
        {(count ?? 0) > (ledger?.length ?? 0) ? (
          <p className="text-xs text-muted-foreground">
            {t('earnings.showing')
              .replace('{n}', localeNumber(locale, ledger?.length ?? 0))
              .replace('{total}', localeNumber(locale, count ?? 0))}{' '}
            {t('earnings.narrow')}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Green amounts are yours. Plain amounts are company cash you collected.
        </p>
      </section>
    </div>
  )
}

const LEDGER_LABEL: Record<string, string> = {
  cod_collected: 'COD collected',
  cod_remitted: 'Cash handed in',
  commission_earned: 'Delivery commission',
  platform_fee: 'Platform fee',
  adjustment: 'Adjustment',
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}
