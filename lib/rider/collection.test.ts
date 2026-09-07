import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { collectionKey, planCollections } from './collection'
import type { RiderJob } from '@/components/rider/job-card'

const SAN_PYA = 'No. 24, Thitsar Road, San Pya Ward, Thingangyun'
const OTHER = 'No. 5, Baho Street, Bahan'

function job(over: Partial<RiderJob> & { id: string }): RiderJob {
  return {
    code: `MGE-${over.id}`,
    status: 'assigned',
    shopName: 'San Pya Mini Mart',
    pickupAddress: SAN_PYA,
    customerName: 'A customer',
    customerPhone: '+959791234567',
    dropoffAddress: 'somewhere',
    dropoffArea: null,
    dropoffLat: 16.8,
    dropoffLng: 96.15,
    parcelDesc: 'Parcel',
    isFragile: false,
    paymentMethod: 'prepaid',
    codAmount: 0,
    commission: null,
    routeKm: null,
    // A collection is a pickup leg — see the predicate in collection.ts. The
    // factory defaulted to 'delivery' when a delivery leg was also collectable.
    leg: 'pickup',
    ...over,
  }
}

describe('planCollections — the ten-parcels-one-shop case', () => {
  /**
   * THE WHOLE POINT. Ten parcels from one shop were ten stops in the rider's
   * list, every one showing a customer's address, and ten separate taps at one
   * counter to record one armful.
   */
  test('ten parcels from one shop are ONE collection and ten parcels', () => {
    const jobs = Array.from({ length: 10 }, (_, i) => job({ id: String(i) }))
    const plan = planCollections(jobs)

    assert.equal(plan.groups.length, 1)
    assert.equal(plan.groups[0]?.jobs.length, 10)
    assert.equal(plan.groups[0]?.address, SAN_PYA)
    assert.equal(plan.groups[0]?.shopName, 'San Pya Mini Mart')
    // None of them is a delivery stop yet — they are not in the rider's hands.
    assert.equal(plan.stops.length, 0)
  })

  test('two shops are two collections', () => {
    const plan = planCollections([
      job({ id: '1' }),
      job({ id: '2', pickupAddress: OTHER, shopName: 'Other Shop' }),
      job({ id: '3' }),
    ])
    assert.equal(plan.groups.length, 2)
    // Biggest armful first.
    assert.equal(plan.groups[0]?.jobs.length, 2)
    assert.equal(plan.groups[1]?.address, OTHER)
  })

  /**
   * A collection empties itself as the run proceeds: once a parcel is aboard it
   * is a delivery stop, and the card disappears when the last one is collected.
   */
  test('a parcel already picked up is a stop, not a collection', () => {
    const plan = planCollections([
      job({ id: '1', status: 'picked_up' }),
      job({ id: '2' }),
    ])
    assert.equal(plan.groups.length, 1)
    assert.equal(plan.groups[0]?.jobs.length, 1)
    assert.equal(plan.stops.length, 1)
    assert.equal(plan.stops[0]?.id, '1')
  })

  test('a fully collected run has no collection card at all', () => {
    const jobs = Array.from({ length: 3 }, (_, i) =>
      job({ id: String(i), status: 'picked_up' }),
    )
    const plan = planCollections(jobs)
    assert.equal(plan.groups.length, 0)
    assert.equal(plan.stops.length, 3)
  })

  /**
   * A return travels TO the shop — it is a delivery of its own. Sweeping it
   * into a collection at the same address would tell the rider to pick up the
   * parcel they are carrying there.
   */
  test('a return leg is never collected, even at the same address', () => {
    const plan = planCollections([
      job({ id: '1' }),
      job({ id: 'r', leg: 'return', pickupAddress: SAN_PYA }),
    ])
    assert.equal(plan.groups.length, 1)
    assert.equal(plan.groups[0]?.jobs.length, 1)
    assert.deepEqual(plan.stops.map((s) => s.id), ['r'])
  })

  test('a pickup leg IS a collection — that is what the leg means', () => {
    const plan = planCollections([job({ id: 'p', leg: 'pickup' })])
    assert.equal(plan.groups.length, 1)
    assert.equal(plan.groups[0]?.jobs.length, 1)
  })
})

describe('planCollections — grouping key and totals', () => {
  /** Two shops at one address are one visit; the rider walks to a place. */
  test('the key is the address, normalised', () => {
    const plan = planCollections([
      job({ id: '1', pickupAddress: SAN_PYA }),
      job({ id: '2', pickupAddress: `  ${SAN_PYA.toUpperCase()}  `, shopName: 'Other' }),
    ])
    assert.equal(plan.groups.length, 1)
    assert.equal(plan.groups[0]?.jobs.length, 2)
  })

  test('collectionKey matches what the grouping used', () => {
    const a = job({ id: '1' })
    const b = job({ id: '2', pickupAddress: `  ${SAN_PYA}  ` })
    assert.equal(collectionKey(a), collectionKey(b))
  })

  /** What the rider will be carrying once the armful is aboard. */
  test('COD is totalled, and prepaid parcels add nothing', () => {
    const plan = planCollections([
      job({ id: '1', paymentMethod: 'cod', codAmount: 24_500 }),
      job({ id: '2', paymentMethod: 'cod', codAmount: 10_000 }),
      job({ id: '3', paymentMethod: 'prepaid', codAmount: 0 }),
    ])
    assert.equal(plan.groups[0]?.codTotal, 34_500)
  })

  test('a missing shop name on one row is filled from another', () => {
    const plan = planCollections([
      job({ id: '1', shopName: null }),
      job({ id: '2', shopName: 'San Pya Mini Mart' }),
    ])
    assert.equal(plan.groups[0]?.shopName, 'San Pya Mini Mart')
  })
})

describe('planCollections — the Directions point', () => {
  /**
   * RiderJob carries only ONE coordinate pair, already flipped for a return, so
   * the shop's own point is not on the job. Without a supplier the group offers
   * no link rather than a link to the customer — which is the bug this whole
   * card exists to stop.
   */
  test('no supplier means no point, never the customer', () => {
    const plan = planCollections([job({ id: '1', dropoffLat: 1, dropoffLng: 2 })])
    assert.equal(plan.groups[0]?.point, null)
  })

  test('a supplied shop point is carried on the group', () => {
    const plan = planCollections([job({ id: '1' })], () => ({ lat: 16.8478, lng: 96.1693 }))
    assert.deepEqual(plan.groups[0]?.point, { lat: 16.8478, lng: 96.1693 })
  })
})

describe('planCollections — nothing to do', () => {
  test('an empty run', () => {
    assert.deepEqual(planCollections([]), { groups: [], stops: [] })
  })
})

describe('planCollections — what 0028 made collectable, and what it did not', () => {
  /**
   * THE BUG THIS CLOSES. Since 0028 a failed delivery that is being retried
   * comes back as `leg = 'delivery'`, `status = 'assigned'` — and the old
   * predicate was `leg !== 'return'`, so it grouped into a collection at the
   * shop's address. The card would have sent a rider across Yangon to fetch a
   * parcel already sitting on our own hub shelf.
   */
  test('a retried delivery is a stop, never a collection', () => {
    const plan = planCollections([
      job({ id: 'retry', leg: 'delivery', status: 'assigned' }),
    ])
    assert.equal(plan.groups.length, 0)
    assert.deepEqual(plan.stops.map((s) => s.id), ['retry'])
  })

  /** A delivery leg already in hand was always a stop, and still is. */
  test('a delivery in hand is a stop', () => {
    const plan = planCollections([job({ id: 'd', leg: 'delivery', status: 'picked_up' })])
    assert.equal(plan.groups.length, 0)
    assert.equal(plan.stops.length, 1)
  })

  /** A leg the dispatcher has not set yet is not a collection either. */
  test('a null leg is not collected', () => {
    const plan = planCollections([job({ id: 'x', leg: null })])
    assert.equal(plan.groups.length, 0)
    assert.equal(plan.stops.length, 1)
  })
})
