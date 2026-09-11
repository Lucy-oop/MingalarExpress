import type { Metadata } from 'next'
import { requireRider } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator, localeNumber } from '@/lib/i18n'
import { getRiderWays } from '@/lib/rider/ways'
import { groupByDay, formatDayHeader, yangonToday } from '@/lib/time/day'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { ChevronRight } from 'lucide-react'
import { formatMmk } from '@/lib/utils'

export const metadata: Metadata = { title: 'Way history' }
export const dynamic = 'force-dynamic'

/**
 * What this rider has already done, run by run.
 *
 * NOT A SECOND EARNINGS PAGE. `/rider/earnings` lists `cod_ledger` lines, which
 * is the right view of the money — every entry, filterable, reconcilable against
 * a settlement. But a `trip_pay` line reads "45,900" with nothing saying which
 * run it was, how many parcels, or which route. "What did I do on Tuesday" is
 * unanswerable from a ledger, and it is the question a rider actually asks.
 *
 * Grouped by DAY rather than listed flat, reusing `groupByDay` from the parcel
 * tables — a rider thinks in shifts, and a run has little meaning outside the
 * day it happened on.
 */
export default async function RiderWaysPage() {
  await requireRider()
  const locale = await getLocale()
  const t = translator(locale)
  const ways = await getRiderWays()
  const n = (v: number) => localeNumber(locale, v)

  const days = groupByDay(ways, (w) => w.at)
  const today = yangonToday()

  return (
    <div className="space-y-4" lang={locale}>
      <div>
        <h1 className="text-lg font-semibold">{t('ways.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('ways.hint')}</p>
      </div>

      {ways.length === 0 ? (
        <Alert tone="info">{t('ways.empty')}</Alert>
      ) : (
        days.map((day) => (
          <section key={day.key} className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {formatDayHeader(day.key, today, locale)}
            </h2>

            <ul className="space-y-2">
              {day.rows.map((way) => (
                <li key={way.id}>
                  {/*
                    NATIVE <details>, NOT A CLIENT COMPONENT. Expanding a card is
                    exactly what this element is for, and doing it in React would
                    turn a server-rendered list into a client bundle on the app's
                    lowest-powered screen for the sake of one toggle. It also
                    works before hydration and with JS disabled.
                  */}
                  <details className="group rounded-lg border bg-card">
                    <summary className="cursor-pointer list-none p-3 [&::-webkit-details-marker]:hidden">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: way.colour }}
                            aria-hidden="true"
                          />
                          <span className="truncate text-base font-semibold">{way.routeName}</span>
                        </span>
                        {/* The pay is what a rider opens this page for, so it is
                            the largest thing on the row. */}
                        <span className="shrink-0 text-lg font-bold tabular-nums">
                          {formatMmk(way.pay)}
                        </span>
                      </div>

                      {/*
                        A PILL, so an active run is separable from a finished one
                        at a glance down the list. `Badge` already carries the
                        rounded-full / px-2.5 / py-0.5 / text-xs / font-medium
                        shape used everywhere else in the app, so this reuses it
                        rather than restating the classes and drifting from them.

                        Gold for a run still out — the same "money in motion"
                        colour as the collect card — and quiet grey for one that
                        is done, because a finished run needs no emphasis.
                      */}
                      <p className="mt-1">
                        <Badge tone={way.status === 'departed' ? 'gold' : 'neutral'}>
                          {way.status === 'departed'
                            ? t('ways.running')
                            : way.status === 'returned'
                              ? t('ways.atHub')
                              : t('ways.done')}
                        </Badge>
                      </p>

                      {/*
                        BOTH HALVES OF THE DAY, EACH WITH ITS OWN MONEY. The row
                        used to print counts only, and a single total — so on a
                        run that both collected and delivered there was no way to
                        see which half earned what. On a 'trip' route the per-half
                        figures are 0 (pay arrives once, at close) and are left
                        off rather than printed as zeroes.
                      */}
                      {/*
                        COUNTS ONLY. The per-half money was printed here beside
                        each count, which meant a card could show three figures
                        in Ks — pickup pay, delivery pay and the total top-right
                        — and a rider had to work out that the first two summed
                        to the third. The total belongs in one place, and the
                        breakdown is a tap away in the list below, per parcel.
                      */}
                      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                        {way.collected > 0 ? (
                          <span>{t('ways.collected').replace('{n}', n(way.collected))}</span>
                        ) : null}
                        {way.delivered > 0 || way.collected === 0 ? (
                          <span>{t('ways.delivered').replace('{n}', n(way.delivered))}</span>
                        ) : null}
                        {/* Only when there were any. A zero here would read as a
                            reproach on a clean run. */}
                        {way.unresolved > 0 ? (
                          <span className="text-amber-700">
                            {t('ways.unresolved').replace('{n}', n(way.unresolved))}
                          </span>
                        ) : null}
                      </p>

                      <p className="mt-2 flex min-h-11 items-center gap-1 text-sm font-medium text-primary">
                        <ChevronRight
                          className="size-4 transition-transform group-open:rotate-90"
                          aria-hidden="true"
                        />
                        {t('ways.parcels')}
                        {way.parcels.length > 0 ? ` (${n(way.parcels.length)})` : ''}
                      </p>
                    </summary>

                    <div className="border-t px-3 py-2">
                      {way.parcels.length === 0 && way.shelved === 0 ? (
                        <p className="py-1 text-sm text-muted-foreground">{t('ways.noParcels')}</p>
                      ) : (
                        <ul className="divide-y">
                          {way.parcels.map((p) => (
                            <li
                              key={p.key}
                              className="flex items-start justify-between gap-3 py-2"
                            >
                              {/*
                                WHO, THEN THE CODE. The tracking id was the
                                primary label, and it is the one thing on the row
                                a rider cannot recognise: sixteen characters that
                                differ in the last three. The name and township
                                are what they actually remember the stop by; the
                                code stays, small and grey, because it is what
                                gets read out to the office.
                              */}
                              <span className="min-w-0 flex-1">
                                <span className="flex items-baseline gap-2">
                                  <span className="min-w-0 truncate text-sm font-medium">
                                    {p.name ?? p.code}
                                  </span>
                                  {p.area ? (
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                      · {p.area}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="mt-0.5 flex items-center gap-2">
                                  {p.name ? (
                                    <span className="font-mono text-xs text-muted-foreground">
                                      {p.code}
                                    </span>
                                  ) : null}
                                  <span className="text-xs text-muted-foreground">
                                    {p.kind === 'collected'
                                      ? t('parcel.pickupBadge')
                                      : t('stat.delivered')}
                                  </span>
                                </span>
                              </span>
                              {p.pay > 0 ? (
                                <span className="shrink-0 text-sm font-medium tabular-nums">
                                  {formatMmk(p.pay)}
                                </span>
                              ) : null}
                            </li>
                          ))}

                          {/*
                            Collections the run is credited with that nothing can
                            still name — see `shelved`. Saying so is honest;
                            "No parcels recorded against this run" contradicted
                            the count in the summary directly above it.
                          */}
                          {way.shelved > 0 ? (
                            <li className="py-2 text-sm text-muted-foreground">
                              {t('ways.handedIn').replace('{n}', n(way.shelved))}
                            </li>
                          ) : null}
                        </ul>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
