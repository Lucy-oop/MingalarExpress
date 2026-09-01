import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { explainDispatchError, type DispatchErrorKind } from './errors'

describe('explainDispatchError', () => {
  /**
   * Left-hand strings are the ACTUAL messages Postgres/PostgREST produce for the
   * RAISE conditions in migration 0002 — captured from a live PostgREST call,
   * not paraphrased.
   */
  const cases: Array<[string, DispatchErrorKind]> = [
    ['order_not_assignable: assigned', 'lost_race'],
    ['order_not_assignable: picked_up', 'lost_race'],
    ['rider_unavailable', 'rider_unavailable'],
    ['order_not_found', 'order_not_found'],
    ['rider_not_found', 'rider_not_found'],
    ['illegal_transition: pending -> delivered', 'illegal_transition'],
    ['forbidden', 'forbidden'],
    ['permission denied for table orders', 'forbidden'],
    ['new row violates row-level security policy for table "orders"', 'forbidden'],
    ['could not serialize access due to concurrent update', 'unknown'],
    ['', 'unknown'],
  ]

  for (const [raw, kind] of cases) {
    test(`"${raw.slice(0, 44)}" -> ${kind}`, () => {
      assert.equal(explainDispatchError(raw).kind, kind)
    })
  }

  test('losing the race is NOT retryable — retrying would assign a second rider', () => {
    const r = explainDispatchError('order_not_assignable: assigned')
    assert.equal(r.retry, false)
    assert.match(r.message, /another dispatcher/i)
  })

  test('an unavailable rider IS retryable with a different rider', () => {
    assert.equal(explainDispatchError('rider_unavailable').retry, true)
  })

  test('a specific condition wins over the generic forbidden text', () => {
    // PostgREST sometimes prefixes the SQLSTATE; the specific reason must survive.
    assert.equal(
      explainDispatchError('42501 order_not_assignable: assigned').kind,
      'lost_race',
    )
  })

  test('null and undefined do not throw', () => {
    assert.equal(explainDispatchError(null).kind, 'unknown')
    assert.equal(explainDispatchError(undefined).kind, 'unknown')
  })

  test('every message is non-empty and free of internal identifiers', () => {
    for (const [raw] of cases) {
      const { message } = explainDispatchError(raw)
      assert.ok(message.length > 10, `too terse for "${raw}"`)
      assert.doesNotMatch(message, /42501|sqlstate|pgrst|_fkey/i)
    }
  })
})
