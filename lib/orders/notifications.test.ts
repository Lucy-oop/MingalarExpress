import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyEvent,
  groupEvents,
  isNewSince,
  unseenCount,
  type EventRow,
} from './notifications'

const AT = '2026-09-07T06:28:40.434431+00:00'

function row(over: Partial<EventRow> & { id: number }): EventRow {
  return {
    fromStatus: 'assigned',
    toStatus: 'picked_up',
    createdAt: AT,
    orderId: `o${over.id}`,
    code: `MGE-260907-00000${over.id}`,
    customerName: 'A customer',
    failReason: null,
    ...over,
  }
}

describe('classifyEvent — the two kinds of failure', () => {
  /**
   * NOT ONE STATUS BUT TWO EVENTS. 0018 already counts these separately for
   * the two attempt ceilings, so "the rider reached your shop and came away
   * empty" and "the customer was not there" are different facts about the same
   * `failed`. A shop that cannot tell them apart cannot act on either.
   */
  test('a failure from assigned means the parcel never left the shop', () => {
    assert.equal(classifyEvent('assigned', 'failed'), 'not_collected')
  })

  test('a failure from picked_up means the delivery could not be made', () => {
    assert.equal(classifyEvent('picked_up', 'failed'), 'delivery_failed')
  })

  test('the good news', () => {
    assert.equal(classifyEvent('assigned', 'picked_up'), 'collected')
    assert.equal(classifyEvent('picked_up', 'delivered'), 'delivered')
    assert.equal(classifyEvent('picked_up', 'returned'), 'returned')
  })

  /**
   * A parcel being put on a run is dispatch moving work around; there is
   * nothing for the shop to do, and a feed that reports it is a feed nobody
   * reads.
   */
  test('nothing is said about assignment, or a cancellation', () => {
    assert.equal(classifyEvent('pending', 'assigned'), null)
    assert.equal(classifyEvent('pending', 'cancelled'), null)
  })
})

describe('groupEvents — an armful is one line', () => {
  /**
   * THE WHOLE POINT, and why the key needs no tolerance. `created_at` defaults
   * to `now()`, which is TRANSACTION time in Postgres, so the ten rows written
   * by one `advance_orders` call carry a byte-identical timestamp. Ten parcels
   * collected in one tap group exactly.
   */
  test('ten parcels collected in one transaction are one group', () => {
    const groups = groupEvents(Array.from({ length: 10 }, (_, i) => row({ id: i })))
    assert.equal(groups.length, 1)
    assert.equal(groups[0]?.kind, 'collected')
    assert.equal(groups[0]?.rows.length, 10)
  })

  /** Two taps a second apart were two handovers, and stay two lines. */
  test('the same kind at a different instant is a second group', () => {
    const groups = groupEvents([
      row({ id: 1 }),
      row({ id: 2, createdAt: '2026-09-07T06:28:41.000000+00:00' }),
    ])
    assert.equal(groups.length, 2)
  })

  /** Different transitions at one instant must never merge. */
  test('two kinds at the same instant stay apart', () => {
    const groups = groupEvents([
      row({ id: 1, toStatus: 'picked_up' }),
      row({ id: 2, fromStatus: 'picked_up', toStatus: 'failed' }),
    ])
    assert.equal(groups.length, 2)
    assert.deepEqual(groups.map((g) => g.kind).sort(), ['collected', 'delivery_failed'])
  })

  test('events a shop is not told about are dropped, not grouped', () => {
    const groups = groupEvents([
      row({ id: 1, fromStatus: 'pending', toStatus: 'assigned' }),
      row({ id: 2 }),
    ])
    assert.equal(groups.length, 1)
    assert.equal(groups[0]?.kind, 'collected')
  })

  test('order is preserved, so newest-first in stays newest-first out', () => {
    const groups = groupEvents([
      row({ id: 1, createdAt: '2026-09-07T09:00:00.000000+00:00' }),
      row({ id: 2, createdAt: '2026-09-07T08:00:00.000000+00:00' }),
    ])
    assert.deepEqual(groups.map((g) => g.at), [
      '2026-09-07T09:00:00.000000+00:00',
      '2026-09-07T08:00:00.000000+00:00',
    ])
  })

  test('an empty feed', () => {
    assert.deepEqual(groupEvents([]), [])
  })
})

describe('groupEvents — the reason', () => {
  test('a shared reason survives onto the group', () => {
    const groups = groupEvents([
      row({ id: 1, fromStatus: 'assigned', toStatus: 'failed', failReason: 'shop shut' }),
      row({ id: 2, fromStatus: 'assigned', toStatus: 'failed', failReason: 'shop shut' }),
    ])
    assert.equal(groups[0]?.reason, 'shop shut')
  })

  /** One parcel's reason shown against ten would misattribute it. */
  test('reasons that disagree are dropped rather than picked from', () => {
    const groups = groupEvents([
      row({ id: 1, fromStatus: 'assigned', toStatus: 'failed', failReason: 'shop shut' }),
      row({ id: 2, fromStatus: 'assigned', toStatus: 'failed', failReason: 'not ready' }),
    ])
    assert.equal(groups[0]?.rows.length, 2)
    assert.equal(groups[0]?.reason, null)
  })
})

describe('unseenCount', () => {
  const groups = groupEvents([
    row({ id: 1, createdAt: '2026-09-07T09:00:00.000Z' }),
    row({ id: 2, createdAt: '2026-09-07T07:00:00.000Z' }),
  ])

  test('everything is unseen until they have looked once', () => {
    assert.equal(unseenCount(groups, null), 2)
  })

  test('only what happened after the mark', () => {
    assert.equal(unseenCount(groups, '2026-09-07T08:00:00.000Z'), 1)
    assert.equal(unseenCount(groups, '2026-09-07T09:00:00.000Z'), 0)
  })

  /**
   * localStorage can hold anything — a cleared value, a half-written string,
   * something from an older version of the app. A junk mark must not hide the
   * feed; it falls back to "you have not looked".
   */
  test('a corrupt mark is treated as never having looked', () => {
    assert.equal(unseenCount(groups, 'not-a-date'), 2)
    assert.equal(unseenCount(groups, ''), 2)
  })
})

describe('isNewSince — the singular of unseenCount', () => {
  /**
   * THE DISAGREEMENT THIS FUNCTION EXISTS TO END.
   *
   * The shop feed used to mark a row new with `seen !== null && at > seen`, so
   * a shop that had NEVER looked saw nothing highlighted — while `unseenCount`
   * counted every group and the bell showed a badge. A first visit should show
   * what was missed, so no marker means new, and both now say so.
   */
  test('no marker means new, agreeing with unseenCount', () => {
    assert.equal(isNewSince('2026-09-08T03:00:00.000Z', null), true)
    assert.equal(unseenCount([{ at: '2026-09-08T03:00:00.000Z' }], null), 1)
  })

  test('older than the marker is not new', () => {
    assert.equal(isNewSince('2026-09-07T00:00:00.000Z', '2026-09-08T00:00:00.000Z'), false)
  })

  test('newer than the marker is', () => {
    assert.equal(isNewSince('2026-09-09T00:00:00.000Z', '2026-09-08T00:00:00.000Z'), true)
  })

  /** Exactly equal is NOT new: it is the instant they looked. */
  test('the marker instant itself is already seen', () => {
    const at = '2026-09-08T00:00:00.000Z'
    assert.equal(isNewSince(at, at), false)
  })

  /** A corrupt marker over-reports rather than hiding the feed — as above. */
  test('an unparseable marker treats everything as new', () => {
    assert.equal(isNewSince('2026-09-08T03:00:00.000Z', 'not a date'), true)
    assert.equal(unseenCount([{ at: '2026-09-08T03:00:00.000Z' }], 'not a date'), 1)
  })

  /** The two must never diverge again, so assert them against each other. */
  test('it is exactly unseenCount for one entry, at every marker', () => {
    const at = '2026-09-08T03:00:00.000Z'
    for (const since of [null, 'not a date', at, '2026-09-07T00:00:00.000Z', '2026-09-09T00:00:00.000Z']) {
      assert.equal(
        isNewSince(at, since),
        unseenCount([{ at }], since) === 1,
        `disagreement at marker ${String(since)}`,
      )
    }
  })
})
