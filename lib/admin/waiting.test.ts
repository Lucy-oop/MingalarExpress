import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { formatAge, hoursWaiting, isStale, STALE_AFTER_HOURS } from './waiting'

const NOW = new Date('2026-09-03T12:00:00Z')
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString()

describe('hoursWaiting', () => {
  test('measures from the timestamp to now', () => {
    assert.equal(hoursWaiting(ago(5), NOW), 5)
    assert.equal(hoursWaiting(ago(0.5), NOW), 0.5)
  })

  test('a parcel with no failure time has no age, rather than an age of zero', () => {
    assert.equal(hoursWaiting(null, NOW), null)
    assert.equal(hoursWaiting('not a date', NOW), null)
  })

  /**
   * The server clock and the browser clock disagree by a second or two, which
   * for a row stamped `now()` reads as a negative age and renders as "-0h".
   */
  test('clock skew reads as just now, never as a negative age', () => {
    assert.equal(hoursWaiting(ago(-0.01), NOW), 0)
  })
})

describe('isStale', () => {
  test(`the threshold is ${STALE_AFTER_HOURS} hours, inclusive`, () => {
    assert.equal(isStale(ago(STALE_AFTER_HOURS - 0.1), NOW), false)
    assert.equal(isStale(ago(STALE_AFTER_HOURS), NOW), true)
    assert.equal(isStale(ago(STALE_AFTER_HOURS + 100), NOW), true)
  })

  /** No timestamp is not an emergency — it is an unknown, and tinting every
   *  unknown row amber would make the tint mean nothing. */
  test('an unknown age is not stale', () => {
    assert.equal(isStale(null, NOW), false)
  })
})

describe('formatAge', () => {
  test('hours below a day, days above', () => {
    assert.equal(formatAge(ago(3), NOW), '3h')
    assert.equal(formatAge(ago(23.9), NOW), '23h')
    assert.equal(formatAge(ago(24), NOW), '1d')
    assert.equal(formatAge(ago(72), NOW), '3d')
  })

  test('under an hour is words, not "0h"', () => {
    assert.equal(formatAge(ago(0.2), NOW), 'just now')
  })

  test('nothing to measure renders as a dash, not "NaN"', () => {
    assert.equal(formatAge(null, NOW), '—')
    assert.equal(formatAge('', NOW), '—')
  })
})
