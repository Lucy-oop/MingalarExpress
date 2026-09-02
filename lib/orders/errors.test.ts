import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { explainResolutionError } from './errors'

/**
 * Left-hand strings are the real RAISE conditions from migration 0011. If one is
 * renamed in SQL without being renamed here the shop falls back to "could not
 * save that decision", which is the failure the drift test at the bottom exists
 * to catch.
 */
describe('explainResolutionError', () => {
  /**
   * The two races that actually happen. A shop is looking at a snapshot: by the
   * time they press a button dispatch may have put the parcel on another run, or
   * the office may have closed it. Both need naming, not a generic error.
   */
  test('explains a parcel that went back out with a rider', () => {
    const m = explainResolutionError('order_in_flight: picked_up')
    assert.match(m, /rider is carrying/i)
    assert.ok(!/_/.test(m), 'must not leak the raw condition')
  })

  test('explains a parcel that is already closed', () => {
    assert.match(explainResolutionError('order_closed: delivered'), /already closed/i)
  })

  test('explains a parcel that never failed', () => {
    assert.match(explainResolutionError('order_never_failed'), /has not failed/i)
  })

  const cases: Array<[string, RegExp]> = [
    ['order_not_found', /no longer exists/i],
    ['bad_resolution: refund', /not a choice/i],
    ['forbidden', /permission/i],
    ['new row violates row-level security policy', /permission/i],
  ]
  for (const [raw, expected] of cases) {
    test(`${raw} is explained`, () => {
      assert.match(explainResolutionError(raw), expected)
    })
  }

  test('an unknown message is a retryable instruction, not a dead end', () => {
    assert.match(explainResolutionError('connection reset by peer'), /Refresh/i)
  })

  test('null and empty are handled without throwing', () => {
    assert.match(explainResolutionError(null), /Refresh/i)
    assert.match(explainResolutionError(undefined), /Refresh/i)
    assert.match(explainResolutionError(''), /Refresh/i)
  })

  test('no message leaks a raw snake_case condition to the shop', () => {
    for (const [raw] of [...cases, ['order_in_flight'], ['order_closed']] as Array<[string]>) {
      const m = explainResolutionError(raw)
      assert.ok(!/_/.test(m), `${raw} leaked: ${m}`)
      assert.ok(m.length > 20, `${raw} too terse: ${m}`)
    }
  })

  /**
   * Every condition this maps must actually be raised by 0011, and every
   * condition 0011 raises should be mapped. A silent mismatch means a shop sees
   * the fallback for a case we have a real sentence for.
   */
  test('the mapped conditions match what migration 0011 raises', () => {
    const sql = readFileSync(
      new URL('../../supabase/migrations/20260902090100_failed_parcel_resolution.sql', import.meta.url),
      'utf8',
    )
    const raised = new Set(
      [...sql.matchAll(/raise exception '([a-z_]+)/g)].map((m) => m[1]),
    )
    for (const c of ['order_in_flight', 'order_closed', 'order_never_failed', 'bad_resolution']) {
      assert.ok(raised.has(c), `0011 no longer raises ${c} — update the error map`)
    }
  })
})
