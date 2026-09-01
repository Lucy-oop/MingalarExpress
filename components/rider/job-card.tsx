import Link from 'next/link'
import { ChevronRight, Coins, MapPin, Package, Phone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/orders/status-badge'
import { formatDistanceKm, formatMmk, formatMyanmarPhone } from '@/lib/utils'
import type { OrderStatus } from '@/types/domain'
import { cn } from '@/lib/utils'

export type RiderJob = {
  id: string
  code: string
  status: OrderStatus
  shopName: string | null
  pickupAddress: string
  customerName: string
  customerPhone: string
  dropoffAddress: string
  dropoffArea: string | null
  parcelDesc: string
  isFragile: boolean
  paymentMethod: 'cod' | 'prepaid'
  codAmount: number
  commission: number | null
  routeKm: number | null
  /** Stop sequence along the run, from route_areas.stop_order. */
  stopOrder?: number | null
  /** 'pickup' means collected on the return leg, not dropped off. */
  leg?: 'delivery' | 'pickup' | null
}

export function JobCard({ job }: { job: RiderJob }) {
  return (
    <Link
      href={`/rider/jobs/${job.id}`}
      className="block rounded-xl border bg-card p-3 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {/* Stop number, not an offer countdown: on a route run the useful
              thing to know is where this parcel sits in the drive. */}
          {job.stopOrder !== null && job.stopOrder !== undefined ? (
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums">
              {job.stopOrder}
            </span>
          ) : null}
          <span className="truncate font-mono text-xs font-semibold">{job.code}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {job.leg === 'pickup' ? <Badge tone="neutral">Pickup</Badge> : null}
          <StatusBadge status={job.status} />
        </span>
      </div>

      <div className="mt-2 space-y-1.5 text-sm">
        <p className="flex items-start gap-1.5">
          <MapPin className="mt-0.5 size-3.5 shrink-0 text-brand-red" />
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">Pick up</span>
            <span className="block truncate">{job.shopName ?? job.pickupAddress}</span>
          </span>
        </p>
        <p className="flex items-start gap-1.5">
          <MapPin className="mt-0.5 size-3.5 shrink-0 text-brand-gold" />
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">Deliver to</span>
            <span className="block truncate">{job.dropoffAddress}</span>
            {job.dropoffArea ? (
              <span className="block text-xs text-muted-foreground">{job.dropoffArea}</span>
            ) : null}
          </span>
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="tabular-nums">{formatDistanceKm(job.routeKm)} trip</span>
        {job.paymentMethod === 'cod' ? (
          <span className="flex items-center gap-1 font-medium tabular-nums text-foreground">
            <Coins className="size-3.5" />
            collect {formatMmk(job.codAmount)}
          </span>
        ) : (
          <Badge tone="neutral">Prepaid</Badge>
        )}
        {job.commission !== null ? (
          <span className="tabular-nums text-emerald-700">you earn {formatMmk(job.commission)}</span>
        ) : null}
        {job.isFragile ? <Badge tone="amber">Fragile</Badge> : null}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <Package className="size-3.5 shrink-0" />
          <span className="truncate">{job.parcelDesc}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-primary">
          <Phone className="size-3" />
          {formatMyanmarPhone(job.customerPhone)}
          <ChevronRight className="size-3.5" />
        </span>
      </div>
    </Link>
  )
}
