import Link from 'next/link'
import { ChevronRight, Coins, MapPin, Store } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { localeNumber } from '@/lib/i18n'
import { useLocale, useT } from '@/components/shared/i18n-provider'
import { cn, formatMmk } from '@/lib/utils'
import type { OrderStatus } from '@/types/domain'

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
  /** Where the rider is actually going — already flipped for a return leg. */
  /**
   * Where this stop actually is. On a pickup or return leg `toJob` flips these
   * to the SHOP's coordinates — and they are NULL when that shop has no map pin
   * (0034/0036), because the alternative was falling back to the customer's,
   * which is precisely where a rider collecting must not go.
   */
  dropoffLat: number | null
  dropoffLng: number | null
  parcelDesc: string
  isFragile: boolean
  paymentMethod: 'cod' | 'prepaid'
  codAmount: number
  commission: number | null
  routeKm: number | null
  /** Stop sequence along the run, from route_areas.stop_order. */
  stopOrder?: number | null
  /** Place in the drive, from sortRoute — 1 is the next stop. */
  stopNumber?: number
  /** Straight-line km from the hub, used to build that order. */
  hubKm?: number | null
  /** 'pickup' means collected on the return leg, not dropped off. */
  leg?: 'delivery' | 'pickup' | 'return' | null
}

/**
 * One stop, after the next one.
 *
 * Radically thinner than it was. It used to carry the pickup address, the
 * parcel description, the trip distance, the commission, the phone number, a
 * status badge and a fragile badge — nine facts about a stop the rider has not
 * reached yet. On a 5-inch screen that is a wall of grey text to scroll past to
 * find the address.
 *
 * What survived is what a rider scanning the list actually uses: which stop,
 * where, and how much to collect. Everything else is one tap away on the parcel
 * page, where there is room for it.
 */
export function JobCard({
  job,
}: {
  job: RiderJob
}) {
  const locale = useLocale()
  const t = useT()
  const collect = job.paymentMethod === 'cod' ? formatMmk(job.codAmount) : t('money.prepaid')

  /*
    A COLLECTION IS A DIFFERENT JOB and now looks like one. The only thing that
    marked one was `Badge tone="neutral"` — grey on grey, the same bg-muted as
    the stop circle beside it — while the row was otherwise identical to a
    delivery: same border, same address slot, same coin figure.

    The coin figure was the worst of it. On a pickup row that amount is money
    the rider collects from a CUSTOMER on a later run, shown against a stop
    which is a shop counter where nothing is paid. It is suppressed here.
  */
  const collecting = job.leg === 'pickup'
  const returning = job.leg === 'return'

  return (
    <Link
      href={`/rider/jobs/${job.id}`}
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-card p-3 active:scale-[0.99]',
        collecting && 'border-l-4 border-l-brand-gold',
        returning && 'border-l-4 border-l-blue-500',
      )}
    >
      {/* The place in the drive, from sortRoute — big enough to find with a
          thumb, because it is how a rider keeps their place in the list. */}
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full text-base font-bold tabular-nums',
          collecting ? 'bg-brand-gold/20 text-charcoal' : 'bg-muted',
        )}
      >
        {collecting ? (
          <Store className="size-5" aria-hidden="true" />
        ) : job.stopNumber !== undefined ? (
          localeNumber(locale, job.stopNumber)
        ) : (
          '·'
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {job.leg === 'pickup' ? <Badge tone="neutral">{t('parcel.pickupBadge')}</Badge> : null}
          {job.leg === 'return' ? <Badge tone="blue">{t('parcel.returnBadge')}</Badge> : null}
          <span className="min-w-0 truncate text-base font-semibold">{job.dropoffAddress}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
          {collecting ? (
            <span className="truncate">{job.shopName ?? t('parcel.pickUp')}</span>
          ) : (
            <>
              {job.dropoffArea ? <span className="truncate">{job.dropoffArea}</span> : null}
              <span className="flex shrink-0 items-center gap-1 font-medium text-foreground">
                <Coins className="size-3.5" aria-hidden="true" />
                <span className="tabular-nums">{collect}</span>
              </span>
            </>
          )}
        </span>
      </span>

      <ChevronRight className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}
