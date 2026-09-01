import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowLeft, Coins, MapPin, Navigation, Package, Phone, Store } from 'lucide-react'
import { requireRider } from '@/lib/auth/guards'
import { getRiderJob } from '@/lib/rider/queries'
import { JobSheet } from '@/components/rider/job-sheet'
import { StatusBadge } from '@/components/orders/status-badge'
import { formatMmk, formatMyanmarPhone } from '@/lib/utils'

export const metadata: Metadata = { title: 'Job' }
export const dynamic = 'force-dynamic'

export default async function RiderJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireRider()
  const { id } = await params

  // RLS returns nothing unless the parcel is theirs, so another rider's job is a
  // 404 — not a permission message that would confirm the order exists.
  const result = await getRiderJob(id, userId)
  if (!result) notFound()

  const { job, raw } = result

  return (
    <div className="space-y-3">
      <Link
        href="/rider/dashboard"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground"
      >
        <ArrowLeft className="size-4" />
        All jobs
      </Link>

      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-semibold">{job.code}</p>
          {job.shopName ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Store className="size-3" />
              {job.shopName}
            </p>
          ) : null}
        </div>
        <StatusBadge status={job.status} />
      </div>

      {/* Money first: it is what the rider is accountable for. */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {job.paymentMethod === 'cod' ? 'Collect from customer' : 'Payment'}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-lg font-semibold tabular-nums">
            {job.paymentMethod === 'cod' ? (
              <>
                <Coins className="size-4 text-brand-gold" />
                {formatMmk(job.codAmount)}
              </>
            ) : (
              'Prepaid'
            )}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">You earn</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-700">
            {job.commission !== null ? formatMmk(job.commission) : '—'}
          </p>
        </div>
      </div>

      <Leg
        tone="pickup"
        label="Pick up"
        address={raw.pickup_address}
        note={raw.pickup_note}
        phone={raw.pickup_contact ?? raw.shops?.phone ?? null}
        lat={raw.pickup_lat}
        lng={raw.pickup_lng}
      />
      <Leg
        tone="dropoff"
        label="Deliver to"
        address={raw.dropoff_address}
        note={raw.dropoff_note}
        subtitle={`${job.customerName}${job.dropoffArea ? ` · ${job.dropoffArea}` : ''}`}
        phone={job.customerPhone}
        altPhone={raw.customer_phone_alt}
        lat={raw.dropoff_lat}
        lng={raw.dropoff_lng}
      />

      <div className="rounded-lg border bg-card p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Package className="size-3.5" />
          Parcel
        </p>
        <p className="mt-1 text-sm">{job.parcelDesc}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {raw.parcel_weight_g ? `${raw.parcel_weight_g} g` : 'Weight not given'}
          {job.isFragile ? ' · FRAGILE — handle with care' : ''}
        </p>
      </div>

      <JobSheet
        orderId={job.id}
        orderCode={job.code}
        status={job.status}
        customerName={job.customerName}
        pickup={{ lat: raw.pickup_lat, lng: raw.pickup_lng }}
        dropoff={{ lat: raw.dropoff_lat, lng: raw.dropoff_lng }}
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
  lat: number
  lng: number
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
      </div>
    </div>
  )
}
