import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowLeft, Coins, MapPin, Navigation, Package, Phone, Search, Store } from 'lucide-react'
import { requireRider } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { getRiderJob, getKpayAccount } from '@/lib/rider/queries'
import { JobPanel } from '@/components/rider/job-panel'
import { StatusBadge } from '@/components/orders/status-badge'
import { codBreakdown } from '@/lib/pricing'
import { cn, formatMmk, formatMyanmarPhone } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

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
      {/*
        THE ONE WAY OFF THIS SCREEN, so it is sized like one.

        `RiderTabs` hides itself on a job (see its docblock — the action bar
        takes that space), which makes this link the entire navigation of the
        page. It was a 16px chevron on a text-sm label: a target well under the
        44px floor the rest of the rider surface holds to, at the top of a
        screen used one-handed, in the rain, with a parcel in the other hand.

        The arrow gets a 44px pill of its own; the label stays outside it so the
        control reads as "back to jobs" rather than as a lone icon, and costs no
        extra vertical space — the row is 44px because the pill is.
      */}
      <Link
        href="/rider/dashboard"
        className="-ml-1 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground"
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-muted active:bg-muted-foreground/20">
          <ArrowLeft className="size-5" aria-hidden="true" />
        </span>
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
              {/*
                THE GOODS ROW GOES WHEN THERE ARE NO GOODS TO COLLECT.

                A customer who paid the shop for the product and left the
                delivery fee for the door produces `cod_amount = delivery_fee`
                and goods 0 — a legitimate parcel, and one that rendered
                "Goods 0" above a small total. A rider reading a zero beside
                Goods assumes the screen has lost the amount and asks for the
                product money as well, which is the one mistake this card
                exists to prevent. The line below says why the figure is small
                instead.
              */}
              {money.goods > 0 ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{t('money.goods')}</dt>
                  <dd className="tabular-nums">{formatMmk(money.goods)}</dd>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t('money.feeOnlyHint')}</p>
              )}
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
              {/*
                THE FIGURE THE RIDER SAYS OUT LOUD, given its own filled block.

                It was the last row of a three-row <dl>, separated from Goods
                and Fee by a hairline rule and a font-size step. That is the
                correct typographic treatment of a sum, and the wrong treatment
                of THE one thing this screen exists to communicate: a rider at a
                gate, one-handed, in sun, scanning for "how much do I ask for"
                had to parse a small table to find it.

                Filled rather than merely bigger, because size alone puts it in
                competition with the COD figures above it; a solid ground takes
                it out of the table entirely and makes it the object on the
                card. Gold is already this app's money colour (the Coins icon
                here, the pickup accents, `--brand-gold`) — it is not the red,
                which everywhere else in the rider app means stop or fail.
              */}
              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-brand-gold/15 px-3 py-2.5">
                <dt className="flex items-center gap-1.5 text-sm font-semibold">
                  <Coins className="size-4 text-brand-gold" aria-hidden="true" />
                  {t('money.total')}
                </dt>
                <dd className="text-3xl font-bold leading-none tabular-nums">
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
          "YOU EARN" IS GONE FROM THIS CARD, and the reason is the card's job.

          For most of this app's life the line was invisible: commission is
          stamped only on a `per_parcel` route, every route was 'trip', so it
          rendered nothing. Migration 0043 stamped the in-flight parcels and it
          appeared for the first time — directly beneath "Collect from
          customer", in the same card, one bold figure under another.

          That card answers exactly one question, asked at a doorstep with a
          customer waiting: HOW MUCH DO I ASK FOR. A second money figure in it
          is a number the rider must actively not say out loud. The risk is not
          that they misread it once; it is that two amounts in one frame make
          the frame something to interpret rather than read.

          The pay is not hidden, it has moved to where it is the subject rather
          than a distraction: /rider/earnings (earned today, and the ledger line
          the delivery books) and /rider/ways, per run. Both are one tab away.
        */}
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
          callLabel={t('action.call')}
          navigateLabel={t('action.navigate')}
          noPinLabel={t('parcel.noPinCall')}
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
          callLabel={t('action.call')}
          navigateLabel={t('action.navigate')}
          noPinLabel={t('parcel.noPinCall')}
        />
      ) : null}

      {/*
        SECTION ONE OF TWO: what is in your hand. Section two — the photo, the
        payment question, the receipt — is the card JobActions renders below,
        headed `proof.section`. Splitting them is not decoration: everything
        here is READ, everything there is ANSWERED, and they were previously a
        continuous run of same-weight cards with no seam between reading and
        doing.
      */}
      <div className="rounded-lg border bg-card p-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Package className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('parcel.section')}
        </p>
        <p className="mt-2 text-sm">{job.parcelDesc}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {raw.parcel_weight_g ? `${raw.parcel_weight_g} g` : 'Weight not given'}
          {job.isFragile ? ` · ${t('parcel.fragile')}` : ''}
        </p>
      </div>

      {/* The panel renders its INPUTS here in flow — the delivery photo, the
          payment choice — and portals its primary button into a thumb-reach bar
          at the bottom of the screen. See ActionBar in job-actions. */}
      <JobPanel
        orderId={job.id}
        orderCode={job.code}
        status={job.status}
        leg={job.leg}
        customerName={job.customerName}
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
  callLabel,
  navigateLabel,
  noPinLabel,
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
  /*
    RESOLVED STRINGS, NOT A TRANSLATOR. `dictionary.test.ts` bans a `t` prop
    outright — "route the locale, not the translator" (57da184) — and this is a
    plain function in a server module, so there is no `useT()` to reach for
    either. `label` and `subtitle` above already arrive resolved; these follow
    the same shape.
  */
  callLabel: string
  navigateLabel: string
  noPinLabel: string
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MapPin className={tone === 'pickup' ? 'size-3.5 text-brand-red' : 'size-3.5 text-brand-gold'} />
        {label}
      </p>
      {/*
        WHO, AND THE BUTTON THAT REACHES THEM, ON ONE ROW. The name sat alone on
        a line and Call was a half-width button two rows below, under the
        address — so "Daw Khin Aye" and the way to ring her were separated by
        the thing you ring her about. Reuniting them costs nothing: the row was
        already half empty.
      */}
      {subtitle ? (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{subtitle}</p>
          {phone ? (
            <a
              href={`tel:${phone}`}
              aria-label={`${callLabel} ${subtitle}`}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'h-11 shrink-0 gap-1.5 px-3 text-sm font-semibold',
              )}
            >
              <Phone className="size-4" />
              {callLabel}
            </a>
          ) : null}
        </div>
      ) : null}

      {/*
        THE ADDRESS IS THE FALLBACK NAVIGATION when nobody ever placed a pin.

        `lat`/`lng` are NULL for a shop that registered on its address alone
        (0034/0036), and this used to mean the Directions button simply did not
        render — the rider was left with a line of text and told to phone. But
        the text IS a Yangon address, and every maps app can search one; it just
        had nothing to tap.

        AN https URL, NOT THE `geo:` THE BUTTON BELOW USES, and the difference
        is deliberate. `geo:` hands off to whatever maps app the phone has,
        which is the right call in Yangon where coverage differs sharply between
        Google, OsmAnd and Maps.me — but iOS does not register a `geo:` handler
        at all, so there it fails SILENTLY. A silent failure is worse than no
        link: the rider taps, nothing happens, and they learn the screen is
        broken. The https form works on both, and Android still offers to open
        it in the app.
      */}
      {lat !== null && lng !== null ? (
        <p className="mt-0.5 text-sm">{address}</p>
      ) : (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 flex min-h-11 items-start gap-1.5 text-sm underline decoration-dotted underline-offset-4"
        >
          <Search className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{address}</span>
        </a>
      )}
      {note ? <p className="mt-1 text-xs text-amber-700">Note: {note}</p> : null}

      {/*
        TWO BUTTONS, FULL WIDTH, NOT A WRAPPING ROW OF LINKS.

        This was three `min-h-10` links — Call, Alt, Navigate, Map — the only
        sub-44px targets left anywhere on the rider surface, and they wrapped to
        a half-width orphan at 360px. They are also the two things a rider does
        most: ring the person and start driving.

        The OpenStreetMap link is gone. It duplicated Navigate, which already
        hands off to whatever maps app the phone has (Google Maps, OsmAnd,
        Maps.me) — the right call in Yangon, where coverage differs sharply
        between them. A fourth small target for a rarer fallback was not worth
        the row it broke.
      */}
      {/*
        DIRECTIONS TAKES THE FULL WIDTH NOW that Call has moved up beside the
        name. It is the one thing a rider does from this card while moving, and
        a full-width target is the easiest thing on the screen to hit.

        On a leg with no name to sit beside — a pickup, where the shop is the
        card — Call keeps its place here as the second half of the row.
      */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {phone && !subtitle ? (
          <a
            href={`tel:${phone}`}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'touch', block: true }),
              'text-base font-semibold',
            )}
          >
            <Phone />
            {callLabel}
          </a>
        ) : null}
        {lat !== null && lng !== null ? (
          <a
            href={`geo:${lat},${lng}?q=${lat},${lng}`}
            className={cn(
              buttonVariants({ size: 'touch', block: true }),
              'text-base font-semibold',
              (subtitle || !phone) && 'col-span-2',
            )}
          >
            <Navigation />
            {navigateLabel}
          </a>
        ) : (
          /* The address above is now itself the maps search, so this says why
             there is no button rather than leaving a dead half-row. */
          <p
            className={cn(
              'flex min-h-11 items-center text-xs text-muted-foreground',
              (subtitle || !phone) && 'col-span-2',
            )}
          >
            {noPinLabel}
          </p>
        )}
      </div>

      {/* The second number is a fallback, not a peer of the two buttons above —
          it had its own equal-sized button and competed with them. */}
      {altPhone ? (
        <a
          href={`tel:${altPhone}`}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-2"
        >
          <Phone className="size-4" />
          {formatMyanmarPhone(altPhone)}
        </a>
      ) : null}
    </div>
  )
}
