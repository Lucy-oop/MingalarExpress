'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Coins, PackageOpen, RefreshCw, Route as RouteIcon, Truck } from 'lucide-react'
import { OnlineToggle } from '@/components/rider/online-toggle'
import { JobCard } from '@/components/rider/job-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import { formatMmk } from '@/lib/utils'
import type { RiderFeed } from '@/lib/rider/queries'

/**
 * The rider's run.
 *
 * Since 0009 there is no offer feed and no countdown: parcels are loaded onto a
 * run at the hub and arrive already assigned. What replaces the "new jobs"
 * section is the MANIFEST — the same parcels, ordered by the route's stop
 * sequence, so the list on the phone is the order the rider drives.
 *
 * Realtime keeps it honest: `trips` UPDATEs are the "your run just departed"
 * signal (it replaced `order_assignments` in the publication), and `orders`
 * UPDATEs cover a parcel being unloaded. Both are RLS-filtered, so a rider only
 * ever receives rows they may see.
 */
export function RiderDashboard({ riderId, feed }: { riderId: string; feed: RiderFeed }) {
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
  const atCapacity = feed.profile ? feed.profile.activeCount >= feed.profile.maxActive : false

  return (
    <div className="space-y-4">
      <OnlineToggle
        riderId={riderId}
        initialOnline={feed.profile?.isOnline ?? false}
        onOnlineChange={() => router.refresh()}
      />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Today" value={formatMmk(feed.earnings.earnedToday)} />
        <Stat label="Delivered" value={String(feed.earnings.deliveredToday)} />
        <Stat
          label="Cash held"
          value={formatMmk(feed.earnings.codInHand)}
          tone={feed.earnings.codInHand > 0 ? 'warn' : undefined}
        />
      </div>

      {/* ---- today's run --------------------------------------------- */}
      {feed.trip ? (
        <section
          className="rounded-xl border-l-4 bg-card p-3"
          style={{ borderLeftColor: feed.trip.colour }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <RouteIcon className="size-4 shrink-0" />
                <span className="truncate">{feed.trip.routeName}</span>
              </p>
              {feed.trip.routeNameMm ? (
                <p className="truncate text-xs text-muted-foreground">{feed.trip.routeNameMm}</p>
              ) : null}
            </div>
            <Badge tone={feed.trip.status === 'departed' ? 'green' : 'gold'}>
              {feed.trip.status === 'departed'
                ? 'On the road'
                : feed.trip.status === 'returned'
                  ? 'Back at hub'
                  : 'Loading at hub'}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {deliveries.length} to deliver
            {pickups.length > 0 ? ` · ${pickups.length} to collect` : ''}
            {feed.trip.status !== 'departed'
              ? ' · wait for dispatch to send the run out'
              : ''}
          </p>
        </section>
      ) : null}

      {/* ---- active -------------------------------------------------- */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Truck className="size-4" />
            {feed.trip ? 'Manifest' : 'Your deliveries'}
            {feed.profile ? (
              <span className="text-xs font-normal text-muted-foreground">
                {feed.profile.activeCount}/{feed.profile.maxActive}
              </span>
            ) : null}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true)
              router.refresh()
              setTimeout(() => setRefreshing(false), 600)
            }}
          >
            <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
          </Button>
        </div>

        {feed.active.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
            <PackageOpen className="size-7 text-muted-foreground" />
            <p className="text-sm font-medium">No deliveries right now</p>
            <p className="text-xs text-muted-foreground">
              {feed.trip
                ? 'Your run has no parcels loaded yet.'
                : feed.profile?.isOnline
                  ? atCapacity
                    ? 'You are at your parcel limit.'
                    : 'Dispatch will put you on a run.'
                  : 'Go online so dispatch can put you on a run.'}
            </p>
          </div>
        ) : (
          feed.active.map((job) => <JobCard key={job.id} job={job} />)
        )}
      </section>

      {feed.earnings.codInHand > 0 ? (
        <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          <Coins className="size-3.5 shrink-0" />
          You are holding {formatMmk(feed.earnings.codInHand)} of company cash. Hand it in at the
          end of your shift.
        </p>
      ) : null}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-lg border bg-card p-2.5 text-center">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 text-sm font-semibold tabular-nums ${
          tone === 'warn' ? 'text-amber-700' : ''
        }`}
      >
        {value}
      </p>
    </div>
  )
}
