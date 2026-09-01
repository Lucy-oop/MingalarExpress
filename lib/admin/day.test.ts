import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDayParam, yangonToday } from './day'

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
