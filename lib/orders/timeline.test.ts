import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTimeline, describeTerminal, type TimelineEvent } from './timeline'
import type { OrderStatus } from '@/types/domain'

/** Trails copied verbatim from staging — see the commit for the dumps. */
const trail = (...pairs: Array<[OrderStatus, string]>): TimelineEvent[] =>
  pairs.map(([status, at]) => ({ status, at }))

const NEVER_COLLECTED = trail(
  ['pending', '2026-09-03T01:00:00Z'],
  ['assigned', '2026-09-03T02:00:00Z'],
  ['failed', '2026-09-03T03:00:00Z'],
)

const DELIVERED = trail(
  ['pending', '2026-09-02T01:00:00Z'],
  ['assigned', '2026-09-02T02:00:00Z'],
  ['picked_up', '2026-09-02T03:00:00Z'],
  ['delivered', '2026-09-02T04:00:00Z'],
)

const THREE_ATTEMPTS = trail(
  ['pending', '2026-09-01T01:00:00Z'],
  ['assigned', '2026-09-01T02:00:00Z'],
  ['picked_up', '2026-09-01T03:00:00Z'],
  ['failed', '2026-09-01T04:00:00Z'],
  ['pending', '2026-09-02T01:00:00Z'],
  ['assigned', '2026-09-02T02:00:00Z'],
  ['picked_up', '2026-09-02T03:00:00Z'],
  ['failed', '2026-09-02T04:00:00Z'],
  ['pending', '2026-09-03T01:00:00Z'],
  ['assigned', '2026-09-03T02:00:00Z'],
  ['picked_up', '2026-09-03T03:00:00Z'],
  ['failed', '2026-09-03T04:00:00Z'],
)

const RETURNED = trail(
  ['pending', '2026-09-01T01:00:00Z'],
  ['assigned', '2026-09-01T02:00:00Z'],
  ['picked_up', '2026-09-01T03:00:00Z'],
  ['failed', '2026-09-01T04:00:00Z'],
  ['assigned', '2026-09-02T02:00:00Z'],
  ['returned', '2026-09-02T05:00:00Z'],
)

const step = (m: ReturnType<typeof buildTimeline>, s: OrderStatus) =>
  m.steps.find((x) => x.status === s)!

describe('buildTimeline — a parcel that was collected then failed', () => {
  /**
   * THE REPORTED SYMPTOM, in the case where the complaint is correct. A rider
   * who has the parcel and cannot deliver it must not leave "Picked up" looking
   * untouched — that reads as "lost at the hub".
   */
  test('Picked up is ticked, because it happened', () => {
    const m = buildTimeline('failed', THREE_ATTEMPTS)
    assert.equal(step(m, 'picked_up').done, true)
    assert.equal(step(m, 'assigned').done, true)
    assert.equal(step(m, 'pending').done, true)
    assert.equal(m.collected, true)
  })

  test('Delivered stays untouched — nothing was delivered', () => {
    assert.equal(step(buildTimeline('failed', THREE_ATTEMPTS), 'delivered').done, false)
  })

  test('the terminal step is the failure', () => {
    const m = buildTimeline('failed', THREE_ATTEMPTS)
    assert.equal(m.terminal?.status, 'failed')
    assert.equal(m.terminal?.at, '2026-09-03T04:00:00Z')
  })
})

describe('buildTimeline — a parcel that was never collected', () => {
  /**
   * THE ONE THAT MUST NOT BE "FIXED" BY TICKING THE BOX. `assigned -> failed` is
   * legal and means the rider reached the shop and came away empty-handed. The
   * parcel is on the shop's own shelf; claiming a pickup would be a false
   * statement about who holds the goods.
   */
  test('Picked up is NOT ticked, because it did not happen', () => {
    const m = buildTimeline('failed', NEVER_COLLECTED)
    assert.equal(step(m, 'picked_up').done, false)
    assert.equal(m.collected, false)
  })

  test('but Assigned is, so the greyed step reads as a gap and not a glitch', () => {
    const m = buildTimeline('failed', NEVER_COLLECTED)
    assert.equal(step(m, 'assigned').done, true)
  })
})

describe('buildTimeline — retries show the CURRENT attempt', () => {
  /**
   * The second bug. The old timeline took the FIRST event of each status, so a
   * parcel on attempt three displayed attempt one's timestamps: a rider who
   * collected it an hour ago looked to have held it for three days.
   */
  test('timestamps come from the latest attempt, not the first', () => {
    const m = buildTimeline('failed', THREE_ATTEMPTS)
    assert.equal(step(m, 'assigned').at, '2026-09-03T02:00:00Z')
    assert.equal(step(m, 'picked_up').at, '2026-09-03T03:00:00Z')
  })

  test('and the attempt number is counted from the re-queues', () => {
    assert.equal(buildTimeline('failed', THREE_ATTEMPTS).attempt, 3)
    assert.equal(buildTimeline('failed', NEVER_COLLECTED).attempt, 1)
    assert.equal(buildTimeline('delivered', DELIVERED).attempt, 1)
  })

  /**
   * A parcel auto-retried back to `pending` is mid-attempt-two with nothing
   * having happened yet, so attempt one's pickup must not still be ticked —
   * that would say the rider has it when it is sitting in the pool.
   */
  test('a fresh attempt does not inherit the previous one’s pickup', () => {
    const requeued = THREE_ATTEMPTS.slice(0, 5) // ...failed, then pending again
    const m = buildTimeline('pending', requeued)
    assert.equal(step(m, 'picked_up').done, false)
    assert.equal(step(m, 'assigned').done, false)
    assert.equal(m.collected, false)
    assert.equal(m.attempt, 2)
  })
})

describe('buildTimeline — the happy path and the return', () => {
  test('a delivered parcel has all four ticked', () => {
    const m = buildTimeline('delivered', DELIVERED)
    assert.ok(m.steps.every((s) => s.done))
    assert.equal(m.terminal, null)
  })

  test('a return is terminal but is not a failure', () => {
    const m = buildTimeline('returned', RETURNED)
    assert.equal(m.terminal?.status, 'returned')
    assert.equal(m.collected, true)
    assert.equal(step(m, 'delivered').done, false)
  })

  /**
   * FOUND BY DUMPING REAL DATA, not by reading the code. A return leg is a
   * SECOND `assigned`, hours after the pickup, so reading the last occurrence
   * of each status printed "assigned 04:10" above "picked up 13:29 the day
   * before" — a timeline running backwards on the shop's own screen.
   */
  test('a return leg’s second assignment does not reorder the timeline', () => {
    const m = buildTimeline('returned', RETURNED)
    assert.equal(step(m, 'assigned').at, '2026-09-01T02:00:00Z') // the first one
    assert.ok(
      step(m, 'assigned').at! < step(m, 'picked_up').at!,
      'assigned must not be stamped after picked_up',
    )
  })

  test('every stamped step reads in chronological order', () => {
    for (const t of [DELIVERED, THREE_ATTEMPTS, RETURNED, NEVER_COLLECTED]) {
      const stamps = buildTimeline(t[t.length - 1]!.status, t)
        .steps.map((s) => s.at)
        .filter((a): a is string => a !== null)
      const sorted = [...stamps].sort()
      assert.deepEqual(stamps, sorted, `out of order: ${stamps.join(' ')}`)
    }
  })

  test('a parcel in flight ticks what has happened and no more', () => {
    const m = buildTimeline('picked_up', DELIVERED.slice(0, 3))
    assert.equal(step(m, 'picked_up').done, true)
    assert.equal(step(m, 'delivered').done, false)
  })
})

describe('buildTimeline — nothing to draw', () => {
  test('an empty trail does not throw, and ticks nothing it cannot prove', () => {
    const m = buildTimeline('pending', [])
    assert.equal(m.steps.length, 4)
    assert.equal(m.attempt, 1)
    assert.equal(m.collected, false)
    assert.ok(m.steps.every((s) => s.at === null))
  })

  /** The public tracking page passes no trail at all for some orders. */
  test('a missing trail still marks the steps already passed', () => {
    const m = buildTimeline('picked_up', [])
    assert.equal(m.steps.find((s) => s.status === 'pending')!.done, true)
    assert.equal(m.steps.find((s) => s.status === 'assigned')!.done, true)
    // `picked_up` itself has no stamp and is not BEFORE the current index, so it
    // is not claimed as done — the index fallback deliberately under-reports
    // rather than inventing a checkpoint.
    assert.equal(m.steps.find((s) => s.status === 'delivered')!.done, false)
  })
})

describe('describeTerminal', () => {
  test('an uncollected parcel says where it actually is', () => {
    const d = describeTerminal('failed', false)
    assert.match(d.title, /collect/i)
    assert.match(d.detail!, /still at your shop/i)
  })

  test('a collected parcel says we have it', () => {
    const d = describeTerminal('failed', true)
    assert.match(d.title, /attempt failed/i)
    assert.match(d.detail!, /safe with us/i)
  })

  test('the two failures never read the same', () => {
    assert.notEqual(describeTerminal('failed', true).title, describeTerminal('failed', false).title)
  })

  test('a return is not described as a failure', () => {
    const d = describeTerminal('returned', true)
    assert.ok(!/fail/i.test(d.title))
  })

  test('cancelled needs no reassurance', () => {
    assert.equal(describeTerminal('cancelled', false).detail, null)
  })
})

/**
 * The same component renders on the shop's page and on the PUBLIC tracking page.
 * The shop-facing copy names custody — "still at your shop", "back at the hub" —
 * which a customer must not read: it is a shop that is not theirs, and the shop
 * failing to hand a parcel over is not ours to tell them about.
 */
describe('describeTerminal — the customer sees less', () => {
  for (const collected of [true, false]) {
    test(`no custody detail leaks (collected: ${collected})`, () => {
      for (const status of ['failed', 'returned', 'cancelled'] as OrderStatus[]) {
        const d = describeTerminal(status, collected, 'customer')
        const text = `${d.title} ${d.detail ?? ''}`
        assert.ok(!/your shop/i.test(text), `leaked "your shop": ${text}`)
        assert.ok(!/hub/i.test(text), `leaked the hub: ${text}`)
        assert.ok(!/rider/i.test(text), `named the rider: ${text}`)
      }
    })
  }

  test('a customer is still told the truth, without the attribution', () => {
    const d = describeTerminal('failed', false, 'customer')
    assert.match(d.title, /not delivered/i)
    assert.match(d.detail!, /try again/i)
  })

  test('the two audiences never see the same failure copy', () => {
    assert.notEqual(
      describeTerminal('failed', true, 'shop').detail,
      describeTerminal('failed', true, 'customer').detail,
    )
  })

  test('a customer cannot tell a collection failure from a delivery failure', () => {
    // Deliberate: whose fault it was is between the platform and the shop.
    assert.deepEqual(
      describeTerminal('failed', true, 'customer'),
      describeTerminal('failed', false, 'customer'),
    )
  })

  test('the shop default is unchanged when no audience is passed', () => {
    assert.deepEqual(describeTerminal('failed', false), describeTerminal('failed', false, 'shop'))
  })
})
