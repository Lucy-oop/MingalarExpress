import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  explainTripError,
  OVERRIDE_REASON_MIN_LENGTH,
  validateOverrideReason,
} from './errors'

/**
 * Left-hand strings are the real RAISE conditions from migration 0008. If one is
 * renamed in SQL without being renamed here, the board falls back to "could not
 * complete that" — which is exactly the failure the drift test at the bottom of
 * this file exists to catch.
 */
describe('explainTripError', () => {
  /**
   * THE IMPORTANT ONE. `requiresOverride` in the server action is derived from
   * this kind, and that is what opens the reason modal. Classify it as anything
   * else and a dispatcher can never send a legitimate short run — they just get
   * an error they cannot act on.
   */
  test('trip_below_minimum is its own kind, not a generic failure', () => {
    const e = explainTripError('trip_below_minimum: 14/20 parcels')
    assert.equal(e.kind, 'below_minimum')
    assert.equal(e.retry, false)
  })

  test('an override reason that is too short says so', () => {
    assert.equal(explainTripError('override_reason_too_short').kind, 'reason_too_short')
  })

  const cases: Array<[string, string]> = [
    ['trip_has_no_rider', 'no_rider'],
    ['rider_already_on_trip', 'rider_busy'],
    ['trip_empty', 'empty'],
    ['trip_over_cod_cap: 2500000 > 2000000', 'over_cod_cap'],
    ['trip_over_parcel_cap: 61 > 60', 'over_parcel_cap'],
    ['leg_resolution_mismatch: 2 parcel(s)', 'orders_not_loadable'],
    ['orders_not_loadable: 3 of 5 eligible', 'orders_not_loadable'],
    ['order_on_trip', 'orders_not_loadable'],
    ['trip_not_loadable: departed', 'not_loadable'],
    ['trip_has_open_orders: 4', 'open_orders'],
    ['trip_orders_not_ready: 2', 'open_orders'],
    ['trip_not_departable: closed', 'wrong_state'],
    ['trip_already_closed', 'wrong_state'],
    ['route_inactive: ROUTE_D', 'wrong_state'],
    ['trip_not_found', 'not_found'],
    ['forbidden', 'forbidden'],
  ]

  for (const [raw, kind] of cases) {
    test(`${raw} -> ${kind}`, () => {
      assert.equal(explainTripError(raw).kind, kind)
    })
  }

  /**
   * `trip_below_minimum`'s hint mentions "parcels", and so does
   * `trip_over_parcel_cap`. Ordering in the map is what keeps them apart, so it
   * is worth pinning: a below-minimum message must never be read as a cap error,
   * or the modal never opens.
   */
  test('the below-minimum hint text does not match a cap error first', () => {
    const withHint =
      'trip_below_minimum: 14/20 parcels — Pass override_reason (10 characters or more) to dispatch this run anyway.'
    assert.equal(explainTripError(withHint).kind, 'below_minimum')
  })

  test('an unknown message is retryable rather than silently fatal', () => {
    const e = explainTripError('connection reset by peer')
    assert.equal(e.kind, 'unknown')
    assert.equal(e.retry, true)
  })

  test('null and empty are handled without throwing', () => {
    assert.equal(explainTripError(null).kind, 'unknown')
    assert.equal(explainTripError(undefined).kind, 'unknown')
    assert.equal(explainTripError('').kind, 'unknown')
  })

  test('every message is something a dispatcher can act on', () => {
    for (const [raw] of cases) {
      const { message } = explainTripError(raw)
      // No raw SQLSTATE or snake_case condition leaking into the UI.
      assert.ok(message.length > 15, `${raw} message too terse: ${message}`)
      assert.ok(!/_/.test(message), `${raw} message leaks a raw condition: ${message}`)
    }
  })
})

describe('validateOverrideReason', () => {
  test('empty is refused', () => {
    assert.ok(validateOverrideReason('') !== null)
    assert.ok(validateOverrideReason('   ') !== null)
  })

  test('under the floor is refused, and says how far off', () => {
    const problem = validateOverrideReason('too short')
    assert.ok(problem !== null)
    assert.match(problem!, /9 so far/)
  })

  test('whitespace does not count toward the floor', () => {
    // 9 real characters padded to 20 must still fail, or the floor is decorative.
    assert.ok(validateOverrideReason('  too short  ') !== null)
  })

  test('a real reason passes', () => {
    assert.equal(
      validateOverrideReason('Customer promised same-day on 4 downtown parcels.'),
      null,
    )
  })

  test(`exactly ${OVERRIDE_REASON_MIN_LENGTH} characters passes`, () => {
    assert.equal(validateOverrideReason('a'.repeat(OVERRIDE_REASON_MIN_LENGTH)), null)
    assert.ok(validateOverrideReason('a'.repeat(OVERRIDE_REASON_MIN_LENGTH - 1)) !== null)
  })

  /**
   * SQL is the authority: `depart_trip` raises `override_reason_too_short` below
   * 10, and `trips_depart_override_sane` refuses the row. This mirror only exists
   * so a dispatcher gets the character count without a round trip — so it must
   * agree with the migration, or it will reject a reason SQL would accept.
   */
  test('the floor matches the CHECK in migration 0008', () => {
    const sql = readFileSync(
      new URL('../../supabase/migrations/20260825090800_trips_rpc.sql', import.meta.url),
      'utf8',
    )
    const m = /length\(trim\(depart_override_reason\)\)\s*>=\s*(\d+)/.exec(sql)
    assert.ok(m, 'override length CHECK not found in 0008')
    assert.equal(Number(m![1]), OVERRIDE_REASON_MIN_LENGTH)

    const guard = /length\(v_reason\)\s*<\s*(\d+)/.exec(sql)
    assert.ok(guard, 'depart_trip length guard not found in 0008')
    assert.equal(Number(guard![1]), OVERRIDE_REASON_MIN_LENGTH)
  })
})
