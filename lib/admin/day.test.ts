import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { isoAddDays, isoDaysAgo, nextDay, parseDayParam, yangonToday } from './day'

describe('yangonToday', () => {
  /**
   * Yangon is UTC+06:30. Between 17:30 and 24:00 UTC it is already tomorrow in
   * Myanmar -- which is precisely the window in which an evening's deliveries
   * get settled. A settlement screen running on the UTC date would file them
   * under the wrong day for six and a half hours out of every twenty-four.
   */
  test('is one day ahead of UTC after 17:30 UTC', () => {
    assert.equal(yangonToday(new Date('2026-08-25T17:29:00Z')), '2026-08-25')
    assert.equal(yangonToday(new Date('2026-08-25T17:30:00Z')), '2026-08-26')
    assert.equal(yangonToday(new Date('2026-08-25T23:59:00Z')), '2026-08-26')
  })

  test('agrees with UTC during the Yangon working day', () => {
    assert.equal(yangonToday(new Date('2026-08-25T03:00:00Z')), '2026-08-25')
    assert.equal(yangonToday(new Date('2026-08-25T11:00:00Z')), '2026-08-25')
  })

  test('rolls the month and the year over', () => {
    assert.equal(yangonToday(new Date('2026-08-31T18:00:00Z')), '2026-09-01')
    assert.equal(yangonToday(new Date('2026-12-31T18:00:00Z')), '2027-01-01')
  })

  test('emits the ISO shape Postgres and <input type=date> both want', () => {
    assert.match(yangonToday(new Date('2026-01-05T04:00:00Z')), /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(yangonToday(new Date('2026-01-05T04:00:00Z')), '2026-01-05')
  })
})

describe('parseDayParam', () => {
  const FALLBACK = '2026-08-26'

  test('accepts a well-formed date', () => {
    assert.equal(parseDayParam('2026-08-01', FALLBACK), '2026-08-01')
  })

  // A junk ?date= reaches PostgREST as a 22P02 and blanks the whole page, so it
  // must be dropped here rather than passed through.
  const junk = ['', undefined, 'today', '2026-8-1', '26-08-01', '2026-13-45', "2026-08-01'; --"]
  for (const raw of junk) {
    test(`rejects ${JSON.stringify(raw)} and falls back`, () => {
      assert.equal(parseDayParam(raw, FALLBACK), FALLBACK)
    })
  }
})

/**
 * Calendar arithmetic, not instant arithmetic.
 *
 * These strings are Yangon calendar dates. Anchoring them at UTC midnight is
 * what keeps `isoDaysAgo(d, 1)` the previous calendar day regardless of where
 * the server is, and what stops a range silently including or excluding a day
 * for six and a half hours out of every twenty-four.
 */
describe('isoAddDays / isoDaysAgo / nextDay', () => {
  test('moves a day forward and back', () => {
    assert.equal(isoAddDays('2026-09-01', 1), '2026-09-02')
    assert.equal(isoDaysAgo('2026-09-01', 1), '2026-08-31')
    assert.equal(nextDay('2026-09-01'), '2026-09-02')
  })

  test('crosses a month boundary', () => {
    assert.equal(nextDay('2026-08-31'), '2026-09-01')
    assert.equal(isoDaysAgo('2026-09-01', 30), '2026-08-02')
  })

  test('crosses a year boundary', () => {
    assert.equal(nextDay('2026-12-31'), '2027-01-01')
    assert.equal(isoDaysAgo('2027-01-01', 1), '2026-12-31')
  })

  test('handles a leap day', () => {
    assert.equal(nextDay('2028-02-28'), '2028-02-29')
    assert.equal(nextDay('2028-02-29'), '2028-03-01')
  })

  test('zero is a no-op', () => {
    assert.equal(isoAddDays('2026-09-01', 0), '2026-09-01')
  })
})
