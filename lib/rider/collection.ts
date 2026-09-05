import type { RiderJob } from '@/components/rider/job-card'

/**
 * One visit to a shop, not ten parcels that happen to share an address.
 *
 * THE PROBLEM THIS SOLVES. A shop books ten parcels; the dispatcher loads all
 * ten onto one run. The rider's feed was a flat list of ten jobs, each showing a
 * CUSTOMER's address, sorted by that customer's distance from the hub and
 * interleaved with every other shop's parcels. The shop appeared nowhere. To
 * record what was physically one armful off one counter the rider opened ten
 * job pages and pressed "I HAVE THE PARCEL" ten times — twenty-odd taps and ten
 * round trips, on a phone with two bars, while the shopkeeper waits.
 *
 * Worse, the next-stop card showed the customer's address and a Directions link
 * to the customer while asking the rider to confirm a collection. They were
 * being navigated away from the place they were standing.
 *
 * WHAT GROUPS AND WHAT DOES NOT. Only parcels still `assigned` — not yet in the
 * rider's hands — belong to a collection. The moment one is `picked_up` it is a
 * delivery stop and leaves the group, so the card empties itself as the run
 * proceeds and disappears when the last parcel is aboard.
 *
 * GROUPED BY ADDRESS, NOT BY SHOP ID. The rider's feed carries the order's
 * `pickup_address` snapshot and the shop's name, not `shop_id`. That is the
 * right key anyway: two shops at one address are one visit, and one shop that
 * moved mid-day is two. The address is what the rider walks to.
 *
 * PER-PARCEL STATE IS KEPT. A group is a view over jobs, never a replacement:
 * a shop handing over nine of ten is still nine individual advances, and the
 * offline queue still holds one entry per order.
 */

export type CollectionGroup = {
  /** Stable key for React and for the bulk action. */
  key: string
  /** What the rider walks to. */
  address: string
  /** The shop's name, when the feed knows it. */
  shopName: string | null
  /** Where Directions should point — the shop, never the customer. */
  point: { lat: number; lng: number } | null
  jobs: RiderJob[]
  /** Cash the rider will be carrying once these are aboard. */
  codTotal: number
}

export type CollectionPlan = {
  /** One per distinct pickup address with parcels still to collect. */
  groups: CollectionGroup[]
  /** Everything already in hand, in the order sortRoute put them. */
  stops: RiderJob[]
}

/** Same key the group is built on, so callers can test membership cheaply. */
export function collectionKey(job: RiderJob): string {
  return job.pickupAddress.trim().toLowerCase()
}

/**
 * `pickupPoint` is passed alongside because `RiderJob` deliberately carries only
 * ONE coordinate pair — `dropoffLat/Lng`, already flipped for a return leg — so
 * the shop's own point is not on the job. Callers that have it (the feed does)
 * supply it; callers that do not get a group with no Directions link rather
 * than a link to the wrong place.
 */
export function planCollections(
  jobs: readonly RiderJob[],
  pickupPointFor?: (job: RiderJob) => { lat: number; lng: number } | null,
): CollectionPlan {
  const groups = new Map<string, CollectionGroup>()
  const stops: RiderJob[] = []

  for (const job of jobs) {
    // A return leg travels TO the shop; it is a delivery of its own and must
    // never be swept into a collection at the same address.
    const collectable = job.status === 'assigned' && job.leg !== 'return'
    if (!collectable) {
      stops.push(job)
      continue
    }

    const key = collectionKey(job)
    const existing = groups.get(key)
    if (existing) {
      existing.jobs.push(job)
      existing.codTotal += job.paymentMethod === 'cod' ? job.codAmount : 0
      // The first non-null name wins: a snapshot can be missing on one row.
      existing.shopName ??= job.shopName
      existing.point ??= pickupPointFor?.(job) ?? null
      continue
    }

    groups.set(key, {
      key,
      address: job.pickupAddress,
      shopName: job.shopName,
      point: pickupPointFor?.(job) ?? null,
      jobs: [job],
      codTotal: job.paymentMethod === 'cod' ? job.codAmount : 0,
    })
  }

  return {
    // Biggest armful first: the shop with ten parcels is the one worth going to
    // before the shop with one. Ties by address so the order is stable between
    // renders rather than following Map insertion by accident.
    groups: [...groups.values()].sort(
      (a, b) => b.jobs.length - a.jobs.length || a.address.localeCompare(b.address),
    ),
    stops,
  }
}
