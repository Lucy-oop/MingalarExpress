'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronDown,
  Coins,
  Navigation,
  PackageCheck,
  PackageOpen,
  Phone,
  RefreshCw,
  Store,
} from 'lucide-react'
import { OnlineToggle } from '@/components/rider/online-toggle'
import { JobCard } from '@/components/rider/job-card'
import { CollectionCard } from '@/components/rider/collection-card'
import { collectionKey, planCollections } from '@/lib/rider/collection'
import { NewWorkAlert } from '@/components/rider/new-work-alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { localeNumber } from '@/lib/i18n'
import { useLocale, useT } from '@/components/shared/i18n-provider'
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
}: {
  riderId: string
  feed: RiderFeed
}) {
  const locale = useLocale()
  const t = useT()
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let nudge: ReturnType<typeof setTimeout> | undefined
    const channel = supabase
      .channel(`rider:${riderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `rider_id=eq.${riderId}` },
        () => router.refresh(),
      )
      /*
        DEBOUNCED, because a collection is now a bulk write. `advance_orders`
        updates ten rows in one transaction and this listener is unfiltered, so
        one tap on the collection card produced ten router.refresh() calls in a
        burst. 400ms, matching route-board and shop-parcel-alert.
      */
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => {
        clearTimeout(nudge)
        nudge = setTimeout(() => router.refresh(), 400)
      })
      .subscribe()

    return () => {
      clearTimeout(nudge)
      void supabase.removeChannel(channel)
    }
  }, [riderId, router])

  const deliveries = useMemo(() => feed.active.filter((j) => j.leg !== 'pickup'), [feed.active])
  /*
    STILL TO FETCH, not "on a pickup leg". This counted parcels already on the
    bike, so the footer told a rider they had three to collect while all three
    were behind them — the same predicate `planCollections` uses for its groups.
  */
  const pickups = useMemo(
    () => feed.active.filter((j) => j.leg === 'pickup' && j.status === 'assigned'),
    [feed.active],
  )

  /*
    ONE CARD PER SHOP, then the stops. `planCollections` groups everything still
    to be collected by pickup address — so ten parcels from one shop are one
    visit — and hands back the rest in drive order. The shop's own coordinates
    come from the feed because RiderJob carries only one pair, already flipped
    for the leg; without a point the group shows no Directions link rather than
    one to the customer.
  */
  const plan = useMemo(
    () =>
      planCollections(feed.active, (job) => feed.pickupPoints[collectionKey(job)] ?? null),
    [feed.active, feed.pickupPoints],
  )

  // Already in drive order, so "next" is simply the first one.
  const next = plan.stops[0]
  const canNavigate = next?.dropoffLat !== null && next?.dropoffLng !== null
  /*
    Collapsed by default: the whole point of the aboard bucket is that these
    need nothing from the rider on the way to the hub. Open is for the moment
    they want to check what they are carrying.
  */
  const [aboardOpen, setAboardOpen] = useState(false)
  const rest = plan.stops.slice(1)
  const n = (v: number) => localeNumber(locale, v)

  return (
    <div className="space-y-3">
      <NewWorkAlert count={feed.active.length} />

      <OnlineToggle
        riderId={riderId}
        initialOnline={feed.profile?.isOnline ?? false}
        onOnlineChange={() => router.refresh()}
      />

      {/*
        NO SCOREBOARD HERE. Four tiles sat above the work: delivered, picked up,
        earned today, cash held. On the screen a rider opens to find out where
        to go, all four read 0 for the first hour of every shift -- a quarter of
        the first screenful spent saying nothing yet.

        Nothing is lost. /rider/earnings shows the same figures against the
        ledger lines that produced them, which is where a rider goes to check
        their money; /rider/ways shows them per run. And the one figure with
        safety weight keeps its place on this screen: the cash line at the
        bottom, which appears only when there IS cash to answer for, rather
        than announcing "0 Ks" all morning.
      */}

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

      {/* ---- shops to collect from ---------------------------------------- */}
      {/*
        THE TWO WAYS, LABELLED. These sections existed only as code comments, so
        a rider saw shop cards, then a highlighted stop, then a list, with
        nothing on screen saying which mode they were in. The aboard line sits
        between them and now reads as the seam it is.
      */}
      {plan.groups.length > 0 ? (
        <h2 className="flex items-baseline gap-2 pt-1 text-xs font-bold uppercase tracking-wide text-brand-red">
          <Store className="size-4 shrink-0" aria-hidden="true" />
          {t('way.collect')}
          <span className="tabular-nums text-muted-foreground">{n(plan.groups.length)}</span>
        </h2>
      ) : null}
      {/*
        ABOVE THE DELIVERIES, and biggest armful first — `planCollections`
        sorts them. A collection is the one job where the run stalls if it is
        skipped: the parcels are not aboard, so nothing downstream can happen.
      */}
      {plan.groups.map((group) => (
        <CollectionCard key={group.key} group={group} pickupRate={feed.rates.pickupRate} />
      ))}

      {/*
        WHAT IS ALREADY ON THE BIKE, in one line.

        These used to be STOPS — each collected parcel became its own "Next
        stop" card with a green DONE — DELIVERED button, which 0029 refuses
        (`collection_not_deliverable`). A rider carrying ten scrolled past ten
        cards that needed nothing from them, and the counter said 1/10 while the
        footer said "0 to deliver".

        They are not ten places to go; they are one hub run. Still shown,
        because a rider should be able to see what they are carrying.
      */}
      {plan.aboard.length > 0 ? (
        <section className="space-y-2">
          {/*
            TAPPABLE, and it was not — which was a real regression. Collapsing
            these to a count was right: they are one hub run, not N stops, and
            each used to render a card offering DONE — DELIVERED on a parcel
            0029 refuses. But making it plain TEXT went too far. A rider
            carrying ten parcels could no longer open one to check a code or an
            address, and for a rider whose whole run is aboard it left the
            dashboard with no way into any parcel at all.

            So: one line by default, expanding to the parcels themselves.
            `JobCard` already links to the detail and already badges a pickup
            leg, so there is nothing new to render.
          */}
          <button
            type="button"
            onClick={() => setAboardOpen((v) => !v)}
            aria-expanded={aboardOpen}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-left text-sm font-medium text-emerald-900 active:bg-emerald-100"
          >
            <PackageCheck className="size-5 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              {t('pickup.aboard')} · {n(plan.aboard.length)}
            </span>
            <ChevronDown
              className={cn('size-5 shrink-0 transition-transform', aboardOpen && 'rotate-180')}
              aria-hidden="true"
            />
          </button>

          {aboardOpen ? (
            <ul className="space-y-2">
              {plan.aboard.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* ---- the next stop ------------------------------------------------ */}
      {plan.stops.length > 0 ? (
        <h2 className="flex items-baseline gap-2 pt-1 text-xs font-bold uppercase tracking-wide text-primary">
          <PackageOpen className="size-4 shrink-0" aria-hidden="true" />
          {t('way.deliver')}
          <span className="tabular-nums text-muted-foreground">{n(plan.stops.length)}</span>
        </h2>
      ) : null}
      {next ? (
        <section className="space-y-2 rounded-xl border-2 border-primary bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-primary">
            {t('jobs.next')} · {n(1)}/{n(plan.stops.length)}
          </p>

          <p className="text-xl font-bold leading-tight">{next.dropoffAddress}</p>
          {next.dropoffArea ? (
            <p className="text-sm text-muted-foreground">{next.dropoffArea}</p>
          ) : null}
          <p className="text-sm font-medium">{next.customerName}</p>

          {/*
            MONEY ONLY WHERE THE LEG ENDS AT A CUSTOMER.

            A RETURN carries a parcel back to the shop and collects nothing, and
            neither branch here was true of it: "collect 12,000" in the gold box
            is money the rider must not ask for, and "Prepaid" is not what
            happened either. `money.collectNothing` is what `JobActions` says in
            the same situation.

            Aboard collections cannot reach this any more — they are no longer
            stops — but the guard is on the LEG rather than on that, so it stays
            correct if one ever does.
          */}
          {next.leg === 'return' || next.leg === 'pickup' ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-base font-semibold">
              {t('money.collectNothing')}
            </p>
          ) : next.paymentMethod === 'cod' ? (
            <p className="flex items-center gap-2 rounded-lg bg-brand-gold/15 px-3 py-2">
              <Coins className="size-6 shrink-0 text-brand-gold" aria-hidden="true" />
              <span className="text-2xl font-bold tabular-nums">{formatMmk(next.codAmount)}</span>
            </p>
          ) : (
            <p className="rounded-lg bg-muted px-3 py-2 text-base font-semibold">
              {t('money.prepaid')}
            </p>
          )}

          {/*
            The two things done at every doorstep, at full width.

            DIRECTIONS ONLY WHERE THERE IS SOMEWHERE TO GO. On a pickup or
            return leg these coordinates are the SHOP's, and a shop that
            registered on its address alone has none (0034/0036) — a template
            would happily build `destination=null,null` and open a maps app on
            nothing, because TypeScript does not object to interpolating null.
            Call then takes the full width: it is the whole answer in that case.
          */}
          <div className={cn('grid gap-2 pt-1', canNavigate ? 'grid-cols-2' : 'grid-cols-1')}>
            <a
              href={`tel:${next.customerPhone}`}
              className={cn(buttonVariants({ size: 'touch', block: true }), 'text-base font-bold')}
            >
              <Phone />
              {t('action.call')}
            </a>
            {canNavigate ? (
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
            ) : null}
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
      ) : plan.groups.length > 0 || plan.aboard.length > 0 ? (
        /*
          Work in hand, just not a STOP. "Nothing to do right now" above a shop
          card telling them to collect ten parcels would be a straight
          contradiction — and `plan.aboard` is the same trap from the other
          side: once collected parcels stopped being stops, a rider driving ten
          of them to the hub had no stops and no groups, and this branch would
          have told them their day was empty.
        */
        null
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
            <JobCard key={job.id} job={job} />
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
