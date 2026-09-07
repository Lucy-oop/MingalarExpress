import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatDayHeader,
  groupByDay,
  isoAddDays,
  isoDaysAgo,
  nextDay,
  parseDayParam,
  yangonDayKey,
  yangonToday,
} from './day'

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

describe('yangonDayKey — why slicing the ISO string is wrong', () => {
  /**
   * THE SIX-AND-A-HALF-HOUR TRAP. A parcel booked at 23:00 Yangon is stored as
   * 16:30Z the SAME day; one booked at 01:00 Yangon is 18:30Z the day BEFORE.
   * `iso.slice(0, 10)` gets the first right and the second wrong, so every
   * evening's work would be filed under yesterday — on a delivery business
   * whose busiest hours are the evening.
   */
  test('an evening in Yangon stays on its own day', () => {
    // 2026-09-06 23:00 +06:30 === 2026-09-06T16:30Z
    assert.equal(yangonDayKey('2026-09-06T16:30:00Z'), '2026-09-06')
  })

  test('and the small hours belong to the day that has begun, not the UTC one', () => {
    // 2026-09-07 01:00 +06:30 === 2026-09-06T18:30Z — a naive slice says the 6th
    assert.equal(yangonDayKey('2026-09-06T18:30:00Z'), '2026-09-07')
    assert.notEqual(yangonDayKey('2026-09-06T18:30:00Z'), '2026-09-06T18:30:00Z'.slice(0, 10))
  })

  test('the boundary itself: 17:30Z is midnight in Yangon', () => {
    assert.equal(yangonDayKey('2026-09-06T17:29:00Z'), '2026-09-06')
    assert.equal(yangonDayKey('2026-09-06T17:30:00Z'), '2026-09-07')
  })
})

describe('groupByDay', () => {
  const row = (at: string, id = at) => ({ id, at })

  test('consecutive rows on one day are one group', () => {
    const groups = groupByDay(
      [row('2026-09-07T03:00:00Z'), row('2026-09-07T02:00:00Z')],
      (r) => r.at,
    )
    assert.equal(groups.length, 1)
    assert.equal(groups[0]?.rows.length, 2)
  })

  test('a day boundary starts a new group', () => {
    const groups = groupByDay(
      [row('2026-09-07T03:00:00Z'), row('2026-09-06T03:00:00Z')],
      (r) => r.at,
    )
    assert.deepEqual(groups.map((g) => g.key), ['2026-09-07', '2026-09-06'])
  })

  /**
   * RUNS, NOT A MAP. The caller has already ordered the rows the way the user
   * asked; regrouping globally would silently reorder a list sorted by
   * something other than the date it is grouped on — which /admin/orders does,
   * sorting by three different columns depending on the saved view.
   */
  test('a day that appears twice stays two groups, in the order given', () => {
    const groups = groupByDay(
      [
        row('2026-09-07T03:00:00Z', 'a'),
        row('2026-09-06T03:00:00Z', 'b'),
        row('2026-09-07T01:00:00Z', 'c'),
      ],
      (r) => r.at,
    )
    assert.deepEqual(groups.map((g) => g.key), ['2026-09-07', '2026-09-06', '2026-09-07'])
    assert.deepEqual(
      groups.flatMap((g) => g.rows.map((r) => r.id)),
      ['a', 'b', 'c'],
    )
  })

  test('an empty list', () => {
    assert.deepEqual(groupByDay([], (r: { at: string }) => r.at), [])
  })
})

describe('formatDayHeader', () => {
  const TODAY = '2026-09-07'

  test('today and yesterday are named, in both languages', () => {
    assert.equal(formatDayHeader(TODAY, TODAY, 'en'), 'Today')
    assert.equal(formatDayHeader(TODAY, TODAY, 'my'), 'ဒီနေ့')
    assert.equal(formatDayHeader('2026-09-06', TODAY, 'en'), 'Yesterday')
    assert.equal(formatDayHeader('2026-09-06', TODAY, 'my'), 'မနေ့က')
  })

  /**
   * THE YEAR IS THE POINT. formatDateTimeYangon renders "06 Sept, 14:30" with
   * no year, so every table shows last September identically to this one. The
   * header is where that gets fixed.
   */
  test('an older date carries the year', () => {
    assert.equal(formatDayHeader('2025-09-06', TODAY, 'en'), '6 Sept 2025')
    assert.match(formatDayHeader('2025-09-06', TODAY, 'en'), /2025/)
  })

  /** First use of Burmese numerals outside a count — see the note on the fn. */
  test('the Burmese header is in Burmese digits, with no Arabic ones left', () => {
    const my = formatDayHeader('2025-09-06', TODAY, 'my')
    assert.match(my, /[၀-၉]/)
    assert.ok(!/[0-9]/.test(my), `an Arabic digit survived: ${my}`)
  })

  test('the two languages never agree on a dated header', () => {
    assert.notEqual(
      formatDayHeader('2025-09-06', TODAY, 'en'),
      formatDayHeader('2025-09-06', TODAY, 'my'),
    )
  })

  /** A month boundary, where an off-by-one in the month index would show. */
  test('January and December land on the right month', () => {
    assert.equal(formatDayHeader('2026-01-01', TODAY, 'en'), '1 Jan 2026')
    assert.equal(formatDayHeader('2026-12-31', TODAY, 'en'), '31 Dec 2026')
    assert.match(formatDayHeader('2026-01-01', TODAY, 'my'), /ဇန်/)
    assert.match(formatDayHeader('2026-12-31', TODAY, 'my'), /ဒီ/)
  })
})
