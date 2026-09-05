import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  alertMessage,
  isPickupEdge,
  mergeTally,
  pickupKind,
  tallyOf,
  tallyTotal,
  EMPTY_TALLY,
} from './parcel-alert'

describe('isPickupEdge — only the moment of collection', () => {
  test('fires on the transition into picked_up', () => {
    assert.equal(isPickupEdge({ status: 'assigned' }, { status: 'picked_up' }), true)
  })

  /**
   * The one that matters. `close_trip` detaching a parcel, a dispatcher editing
   * it, the KPay confirmation — all are UPDATEs on a row that is already
   * picked_up, and each would re-announce a collection from hours ago.
   */
  test('does not fire on a later update to an already-collected parcel', () => {
    assert.equal(isPickupEdge({ status: 'picked_up' }, { status: 'picked_up' }), false)
  })

  test('does not fire for any other destination status', () => {
    for (const status of ['assigned', 'delivered', 'failed', 'returned', 'pending']) {
      assert.equal(isPickupEdge({ status: 'assigned' }, { status }), false, status)
    }
  })

  test('a missing old record is treated as an edge, not a crash', () => {
    // replica identity full means `old` is populated, but an INSERT payload has
    // no old record at all and must not throw.
    assert.equal(isPickupEdge(null, { status: 'picked_up' }), true)
    assert.equal(isPickupEdge(undefined, undefined), false)
  })
})

describe('pickupKind — same status, opposite ends of the journey', () => {
  test('a pickup leg means the rider is standing in the shop', () => {
    assert.equal(pickupKind('pickup'), 'from_shop')
  })

  test('a delivery leg means it left the hub for the customer', () => {
    assert.equal(pickupKind('delivery'), 'to_customer')
    // An order not on a run yet still reads as heading to the customer.
    assert.equal(pickupKind(null), 'to_customer')
    assert.equal(pickupKind(undefined), 'to_customer')
  })

  /** The shop asked for the return; it is told when it ARRIVES, not when it sets off. */
  test('a return leg is not announced', () => {
    assert.equal(pickupKind('return'), null)
  })
})

describe('alertMessage', () => {
  const tally = (fromShop: number, toCustomer: number) => ({ fromShop, toCustomer })

  test('nothing to say when nothing moved', () => {
    assert.equal(alertMessage(EMPTY_TALLY), null)
  })

  test('singular and plural are different keys, not a formatted count', () => {
    assert.deepEqual(alertMessage(tally(1, 0)), { key: 'shop.alert.collectedOne', count: 1 })
    assert.deepEqual(alertMessage(tally(4, 0)), { key: 'shop.alert.collectedMany', count: 4 })
    assert.deepEqual(alertMessage(tally(0, 1)), { key: 'shop.alert.onTheWayOne', count: 1 })
    assert.deepEqual(alertMessage(tally(0, 3)), { key: 'shop.alert.onTheWayMany', count: 3 })
  })

  /**
   * Two banners in the same second would cover each other, and a sentence
   * covering both ends of the journey reads as nonsense. The count is honest.
   */
  test('a mixed batch reports the total rather than inventing a sentence', () => {
    assert.deepEqual(alertMessage(tally(2, 3)), { key: 'shop.alert.movedMany', count: 5 })
  })
})

describe('tally helpers', () => {
  test('counts each side separately', () => {
    const t = tallyOf([
      { code: 'A', kind: 'from_shop' },
      { code: 'B', kind: 'to_customer' },
      { code: 'C', kind: 'to_customer' },
    ])
    assert.deepEqual(t, { fromShop: 1, toCustomer: 2 })
    assert.equal(tallyTotal(t), 3)
  })

  test('merging is what lets the catch-up count and a live event share a banner', () => {
    assert.deepEqual(mergeTally({ fromShop: 1, toCustomer: 0 }, { fromShop: 0, toCustomer: 2 }), {
      fromShop: 1,
      toCustomer: 2,
    })
  })

  test('an empty list tallies to nothing', () => {
    assert.deepEqual(tallyOf([]), EMPTY_TALLY)
    assert.equal(alertMessage(tallyOf([])), null)
  })
})
