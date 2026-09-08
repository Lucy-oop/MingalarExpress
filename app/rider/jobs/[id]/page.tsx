import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowLeft, Coins, MapPin, Navigation, Package, Phone, Store } from 'lucide-react'
import { requireRider } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { getRiderJob, getKpayAccount } from '@/lib/rider/queries'
import { JobSheet } from '@/components/rider/job-sheet'
import { StatusBadge } from '@/components/orders/status-badge'
import { codBreakdown } from '@/lib/pricing'
import { cn, formatMmk, formatMyanmarPhone } from '@/lib/utils'

export const metadata: Metadata = { title: 'Job' }
export const dynamic = 'force-dynamic'

export default async function RiderJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireRider()
  const { id } = await params

  // RLS returns nothing unless the parcel is theirs, so another rider's job is a
  // 404 — not a permission message that would confirm the order exists.
  const [result, locale, kpayAccount] = await Promise.all([
    getRiderJob(id, userId),
    getLocale(),
    getKpayAccount(),
  ])
  if (!result) notFound()
  const t = translator(locale)

  const { job, raw } = result

  const money = codBreakdown(
    raw.cod_amount,
    raw.delivery_fee ?? 0,
    (raw.fee_payer as 'customer' | 'shop') ?? 'customer',
    raw.payment_method,
  )

  /*
    THE SHOP CARD MUST NOT VANISH ON A COLLECTION. This was
    `leg !== 'return' && status === 'assigned'`, so the moment a collection was
    aboard the shop card disappeared and the only address left was the
    customer's, labelled "Deliver to" — for a parcel whose journey ends at the
    hub. On a pickup leg the shop is the whole job, at both statuses.
  */
  const collecting = job.leg === 'pickup'
  const showPickup = collecting || (job.leg !== 'return' && job.status === 'assigned')
  // And the customer is not a destination on a collection run.
  const showDropoff = !collecting

  return (
    <div className="space-y-3">
      <Link
        href="/rider/dashboard"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('nav.jobs')}
      </Link>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold">{job.code}</p>
          {/*
            LABELLED, AND BIGGER ON A DELIVERY. This was text-xs muted under the
            code, which is not where a rider looks when a customer at the door
            asks who sent it. On a collection the shop is the whole card below,
            so it stays quiet there rather than being said twice.
          */}
          {job.shopName ? (
            <p
              className={cn(
                'flex items-center gap-1 truncate',
                collecting ? 'text-xs text-muted-foreground' : 'text-sm font-medium',
              )}
            >
              <Store className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {collecting ? null : (
                <span className="text-muted-foreground">{t('parcel.fromShop')}</span>
              )}
              <span className="truncate">{job.shopName}</span>
            </p>
          ) : null}
        </div>
        <StatusBadge status={job.status} />
      </div>

      {/* Money first: it is what the rider is accountable for.

          A BREAKDOWN, NOT A SUM. cod_amount already contains the delivery fee
          when the customer pays it, so "delivery fee + COD" would tell the rider
          to collect it twice — see codBreakdown in lib/pricing. */}
      {/* Nothing is paid at a shop counter. Showing "Collect from customer" and
          a COD total as the largest figure on the screen was money the rider
          will take from somebody else, on a later run. */}
      <div className="rounded-lg border bg-card p-3">
        {collecting ? (
          <p className="text-base font-medium text-muted-foreground">
            {t('money.collectNothing')}
          </p>
        ) : money.total > 0 ? (
          <>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t('money.collect')}
            </p>
            <dl className="mt-1.5 space-y-1 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">{t('money.goods')}</dt>
                <dd className="tabular-nums">{formatMmk(money.goods)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">
                  {t('money.fee')}
                  {!money.feeFromCustomer ? (
                    <span className="ml-1 text-xs">({t('money.feeOnShop')})</span>
                  ) : null}
                </dt>
                <dd className="tabular-nums">
                  {money.feeFromCustomer ? formatMmk(money.fee) : '—'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t pt-1.5">
                <dt className="font-semibold">{t('money.total')}</dt>
                <dd className="flex items-center gap-1 text-2xl font-bold tabular-nums">
                  <Coins className="size-4 text-brand-gold" aria-hidden="true" />
                  {formatMmk(money.total)}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold">{t('money.prepaid')}</p>
            <p className="text-sm text-muted-foreground">{t('money.collectNothing')}</p>
          </>
        )}
        {/*
          ONLY WHERE IT IS A REAL FIGURE. `rider_commission_amount` is written
          exclusively by `assign_order`, on routes with pay_model =
          'per_parcel' -- and every route is 'trip', where pay is base + per
          parcel + per pickup booked once at close. So this line rendered a
          permanent em-dash on every delivery in the app. A number that is
          always absent teaches a rider to stop reading the row.
        */}
        {job.commission !== null ? (
          <div className="mt-3 flex items-baseline justify-between gap-3 border-t pt-2 text-sm">
            <span className="text-muted-foreground">{t('money.youEarn')}</span>
            <span className="font-semibold tabular-nums text-emerald-700">
              {formatMmk(job.commission)}
            </span>
          </div>
        ) : null}
      </div>

      {/* Only while the rider is still going to COLLECT it.
          Once the parcel is on the bike the shop's address is noise on a screen
          used one-handed at a gate — and on a return leg the shop is already the
          destination below, so showing it twice would be worse than noise. */}
      {showPickup ? (
        <Leg
          tone="pickup"
          label={t('parcel.pickUp')}
          address={raw.pickup_address}
          note={raw.pickup_note}
          phone={raw.pickup_contact ?? raw.shops?.phone ?? null}
          lat={raw.pickup_lat}
          lng={raw.pickup_lng}
        />
      ) : null}
      {/* Not on a collection run. The customer's address, a Navigate link to
          it and their phone number are all things a rider collecting for the
          hub must not be pointed at — this parcel reaches them on a later
          run. */}
      {showDropoff ? (
        <Leg
          tone="dropoff"
          label={t('parcel.deliverTo')}
          address={raw.dropoff_address}
          note={raw.dropoff_note}
          subtitle={`${job.customerName}${job.dropoffArea ? ` · ${job.dropoffArea}` : ''}`}
          phone={job.customerPhone}
          altPhone={raw.customer_phone_alt}
          lat={raw.dropoff_lat}
          lng={raw.dropoff_lng}
        />
      ) : null}

      <div className="rounded-lg border bg-card p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Package className="size-3.5" />
          {t('parcel.contents')}
        </p>
        <p className="mt-1 text-sm">{job.parcelDesc}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {raw.parcel_weight_g ? `${raw.parcel_weight_g} g` : 'Weight not given'}
          {job.isFragile ? ` · ${t('parcel.fragile')}` : ''}
        </p>
      </div>

      <JobSheet
        orderId={job.id}
        orderCode={job.code}
        status={job.status}
        leg={job.leg}
        customerName={job.customerName}
        pickup={
          raw.pickup_lat === null || raw.pickup_lng === null
            ? null
            : { lat: raw.pickup_lat, lng: raw.pickup_lng }
        }
        dropoff={{ lat: raw.dropoff_lat, lng: raw.dropoff_lng }}
        codAmount={money.total}
        kpayAccount={kpayAccount}
      />
    </div>
  )
}

function Leg({
  tone,
  label,
  address,
  subtitle,
  note,
  phone,
  altPhone,
  lat,
  lng,
}: {
  tone: 'pickup' | 'dropoff'
  label: string
  address: string
  subtitle?: string
  note?: string | null
  phone?: string | null
  altPhone?: string | null
  /**
   * NULL when nobody has placed a pin for this place — a shop that registered
   * on its address alone (0034/0036). The two map links then do not render:
   * `geo:null,null` opens a maps app on nothing, which is worse than an absent
   * button because the rider taps it and learns nothing.
   */
  lat: number | null
  lng: number | null
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MapPin className={tone === 'pickup' ? 'size-3.5 text-brand-red' : 'size-3.5 text-brand-gold'} />
        {label}
      </p>
      {subtitle ? <p className="mt-1 text-sm font-medium">{subtitle}</p> : null}
      <p className="mt-0.5 text-sm">{address}</p>
      {note ? <p className="mt-1 text-xs text-amber-700">Note: {note}</p> : null}

      <div className="mt-2 flex flex-wrap gap-2">
        {phone ? (
          <a
            href={`tel:${phone}`}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium text-primary"
          >
            <Phone className="size-4" />
            {formatMyanmarPhone(phone)}
          </a>
        ) : null}
        {altPhone ? (
          <a
            href={`tel:${altPhone}`}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm text-muted-foreground"
          >
            <Phone className="size-4" />
            Alt
          </a>
        ) : null}
        {/*
          `geo:` hands off to whatever navigation app the rider actually uses
          (Google Maps, OsmAnd, Maps.me), which is the right call in Yangon where
          coverage differs sharply between apps. The OSM link is the fallback for
          devices with no geo: handler.
        */}
        {lat !== null && lng !== null ? (
          <>
            <a
              href={`geo:${lat},${lng}?q=${lat},${lng}`}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-secondary px-3 text-sm font-medium"
            >
              <Navigation className="size-4" />
              Navigate
            </a>
            <a
              href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground"
            >
              Map
            </a>
          </>
        ) : (
          /* The address above and the CALL button are the whole answer here,
             and calling the shop is how this is actually done in Yangon. */
          <span className="text-xs text-muted-foreground">No map pin — call to find it</span>
        )}
      </div>
    </div>
  )
}
