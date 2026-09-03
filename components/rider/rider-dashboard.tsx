'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Coins, Navigation, PackageOpen, Phone, RefreshCw } from 'lucide-react'
import { OnlineToggle } from '@/components/rider/online-toggle'
import { JobCard } from '@/components/rider/job-card'
import { NewWorkAlert } from '@/components/rider/new-work-alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { localeNumber, type Locale, type Translate } from '@/lib/i18n'
import { formatMmk } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { RiderFeed } from '@/lib/rider/queries'

/**
 * The rider's run, built around ONE question: where do I go next.
 *
 * THE GOLDEN RULE. Many riders are not confident with apps and this is read
 * one-handed, on a bike mount, often in the rain. So:
 *
 *   - the next stop is a single large card, not a row in a list
 *   - CALL and DIRECTIONS are thumb-sized buttons on that card, because those
 *     are the two things a rider does before every doorstep
 *   - the amount to collect is the largest number on the screen
 *   - everything else is one compact list below, and there are no tabs, no
 *     menus and nothing to scroll past to reach the work
 *
 * The manifest order comes from `sortRoute` — deliveries outwards from the
 * Thingangyun hub, then collections back in — so "next" is genuinely the nearest
 * remaining stop rather than whatever a dispatcher typed into route_areas.
 *
 * Realtime keeps it honest: `trips` UPDATEs are the "your run just departed"
 * signal and `orders` UPDATEs cover a parcel being loaded or unloaded. Both are
 * RLS-filtered, so a rider only ever receives rows they may see.
 */
export function RiderDashboard({
  riderId,
  feed,
  locale,
  t,
}: {
  riderId: string
  feed: RiderFeed
  locale: Locale
  t: Translate
}) {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`rider:${riderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `rider_id=eq.${riderId}` },
        () => router.refresh(),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () =>
        router.refresh(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [riderId, router])

  const deliveries = useMemo(() => feed.active.filter((j) => j.leg !== 'pickup'), [feed.active])
  const pickups = useMemo(() => feed.active.filter((j) => j.leg === 'pickup'), [feed.active])

  // Already in drive order, so "next" is simply the first one.
  const next = feed.active[0]
  const rest = feed.active.slice(1)
  const n = (v: number) => localeNumber(locale, v)

  return (
    <div className="space-y-3">
      <NewWorkAlert count={feed.active.length} locale={locale} t={t} />

      <OnlineToggle
        riderId={riderId}
        initialOnline={feed.profile?.isOnline ?? false}
        onOnlineChange={() => router.refresh()}
        t={t}
      />

      {/* Today's output. Four figures, big enough to read at a glance, and the
          two counts a rider is paid on sit side by side. */}
      <div className="grid grid-cols-2 gap-2">
        <Stat label={t('stat.delivered')} value={n(feed.earnings.deliveredToday)} big />
        <Stat label={t('stat.collected')} value={n(feed.earnings.pickedUpToday)} big />
        <Stat label={t('stat.earnedToday')} value={formatMmk(feed.earnings.earnedToday)} />
        <Stat
          label={t('stat.cashHeld')}
          value={formatMmk(feed.earnings.codInHand)}
          tone={feed.earnings.codInHand > 0 ? 'warn' : undefined}
        />
      </div>

      {feed.trip ? (
        <div
          className="flex items-center justify-between gap-2 rounded-xl border-l-4 bg-card px-3 py-2"
          style={{ borderLeftColor: feed.trip.colour }}
        >
          <span className="min-w-0 truncate text-sm font-semibold">
            {locale === 'my' && feed.trip.routeNameMm ? feed.trip.routeNameMm : feed.trip.routeName}
          </span>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {feed.trip.status === 'departed'
              ? t('run.onTheRoad')
              : feed.trip.status === 'returned'
                ? t('run.atHub')
                : t('run.loading')}
          </span>
        </div>
      ) : null}

      {/* ---- the next stop ------------------------------------------------ */}
      {next ? (
        <section className="space-y-2 rounded-xl border-2 border-primary bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-primary">
            {t('jobs.next')} · {n(1)}/{n(feed.active.length)}
          </p>

          <p className="text-xl font-bold leading-tight">{next.dropoffAddress}</p>
          {next.dropoffArea ? (
            <p className="text-sm text-muted-foreground">{next.dropoffArea}</p>
          ) : null}
          <p className="text-sm font-medium">{next.customerName}</p>

          {next.paymentMethod === 'cod' ? (
            <p className="flex items-center gap-2 rounded-lg bg-brand-gold/15 px-3 py-2">
              <Coins className="size-6 shrink-0 text-brand-gold" aria-hidden="true" />
              <span className="text-2xl font-bold tabular-nums">{formatMmk(next.codAmount)}</span>
            </p>
          ) : (
            <p className="rounded-lg bg-muted px-3 py-2 text-base font-semibold">
              {t('money.prepaid')}
            </p>
          )}

          {/* The two things done at every doorstep, at full width. */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <a
              href={`tel:${next.customerPhone}`}
              className={cn(buttonVariants({ size: 'touch', block: true }), 'text-base font-bold')}
            >
              <Phone />
              {t('action.call')}
            </a>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${next.dropoffLat},${next.dropoffLng}`}
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'touch', block: true }),
                'text-base font-bold',
              )}
            >
              <Navigation />
              {t('action.navigate')}
            </a>
          </div>

          <Link
            href={`/rider/jobs/${next.id}`}
            className={cn(
              buttonVariants({ size: 'touch', block: true }),
              'bg-emerald-600 text-base font-bold hover:bg-emerald-700',
            )}
          >
            {next.leg === 'return'
              ? t('parcel.returnTo')
              : next.status === 'assigned'
                ? t('action.markPickedUp')
                : t('action.markDelivered')}
          </Link>
        </section>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-10 text-center">
          <PackageOpen className="size-10 text-muted-foreground" aria-hidden="true" />
          <p className="text-base font-semibold">{t('jobs.none')}</p>
          <p className="text-sm text-muted-foreground">
            {feed.trip
              ? t('jobs.noneLoading')
              : feed.profile?.isOnline
                ? t('jobs.noneHint')
                : t('jobs.noneOffline')}
          </p>
        </div>
      )}

      {/* ---- everything after it ------------------------------------------ */}
      {rest.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t('jobs.remaining')} · {n(rest.length)}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              disabled={refreshing}
              aria-label={t('action.refresh')}
              onClick={() => {
                setRefreshing(true)
                router.refresh()
                setTimeout(() => setRefreshing(false), 600)
              }}
            >
              <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
            </Button>
          </div>
          {rest.map((job) => (
            <JobCard key={job.id} job={job} locale={locale} t={t} />
          ))}
        </section>
      ) : null}

      {feed.active.length > 0 ? (
        <p className="text-center text-xs text-muted-foreground">
          {t('run.toDeliver', { n: n(deliveries.length) })}
          {pickups.length > 0 ? ` · ${t('run.toCollect', { n: n(pickups.length) })}` : ''}
          {feed.trip && feed.trip.status !== 'departed' ? ` · ${t('run.waitForDispatch')}` : ''}
        </p>
      ) : null}

      {feed.earnings.codInHand > 0 ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm font-medium text-amber-900">
          <Coins className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('cash.warning', { amount: formatMmk(feed.earnings.codInHand) })}
        </p>
      ) : null}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  big,
}: {
  label: string
  value: string
  tone?: 'warn'
  big?: boolean
}) {
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-0.5 font-bold tabular-nums',
          big ? 'text-3xl' : 'text-base',
          tone === 'warn' && 'text-amber-700',
        )}
      >
        {value}
      </p>
    </div>
  )
}
