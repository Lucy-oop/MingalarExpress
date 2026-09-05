import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canDepart,
  departBlocker,
  DEPART_BLOCKER_MESSAGE,
  type DepartGate,
} from './depart-gate'

/** A run that is ready to go, so each test can spoil exactly one thing. */
const READY: DepartGate = {
  status: 'loading',
  riderId: '66666666-6666-6666-6666-666666666666',
  parcelCount: 9,
  pickupCount: 0,
}

describe('departBlocker — the bug this module exists for', () => {
  /**
   * THE REPORT. "Clicking Depart trip does nothing at all." It was disabled on
   * a 0-parcel run and said so nowhere: pointer-events-none removes hover, the
   * cursor and any tooltip, and a disabled button is not focusable either.
   */
  test('an empty run is blocked, and the reason is nameable', () => {
    const gate = { ...READY, parcelCount: 0, pickupCount: 0 }
    assert.equal(canDepart(gate), false)
    assert.equal(departBlocker(gate), 'empty')
    assert.match(DEPART_BLOCKER_MESSAGE.empty, /parcel|pickup/i)
  })

  /**
   * THE CASE THE OLD BOOLEAN MISSED. `canDepart = canLoad && count > 0` never
   * looked for a rider, so this left the button enabled, failed in SQL with
   * trip_has_no_rider, and reported it at the top of the board.
   */
  test('a loaded run with no rider is blocked too', () => {
    const gate = { ...READY, riderId: null }
    assert.equal(canDepart(gate), false)
    assert.equal(departBlocker(gate), 'no_rider')
  })

  test('a loaded run with a rider departs', () => {
    assert.equal(canDepart(READY), true)
    assert.equal(departBlocker(READY), null)
  })
})

describe('departBlocker — what counts as loaded', () => {
  /**
   * A run that collects from ten shops and delivers nothing is a real run.
   * depart_trip counts parcels + pickups for exactly this reason, and a gate
   * that checked parcelCount alone would refuse a legitimate collection run.
   */
  test('pickups alone are enough', () => {
    assert.equal(canDepart({ ...READY, parcelCount: 0, pickupCount: 4 }), true)
  })

  test('parcels alone are enough', () => {
    assert.equal(canDepart({ ...READY, parcelCount: 1, pickupCount: 0 }), true)
  })

  /** Nine parcels is the case the user reported as over-blocked. It is not. */
  test('a short-but-nonempty run is NOT blocked here', () => {
    // Volume against min_parcels_per_trip is depart_trip's business and opens
    // the override modal; it is deliberately not part of this gate.
    assert.equal(canDepart({ ...READY, parcelCount: 9 }), true)
    assert.equal(canDepart({ ...READY, parcelCount: 1 }), true)
  })
})

describe('departBlocker — the order matches depart_trip', () => {
  /**
   * SQL checks status, then rider, then emptiness. If this reported them in
   * another order a dispatcher would be told to load parcels, do it, and only
   * then discover the rider was missing all along.
   */
  test('status outranks everything', () => {
    const wrecked: DepartGate = {
      status: 'departed',
      riderId: null,
      parcelCount: 0,
      pickupCount: 0,
    }
    assert.equal(departBlocker(wrecked), 'not_departable')
  })

  test('a missing rider is reported before an empty load', () => {
    assert.equal(
      departBlocker({ ...READY, riderId: null, parcelCount: 0, pickupCount: 0 }),
      'no_rider',
    )
  })

  test('every non-loadable status is refused', () => {
    for (const status of ['departed', 'returned', 'closed', 'cancelled']) {
      assert.equal(departBlocker({ ...READY, status }), 'not_departable', status)
    }
    for (const status of ['planned', 'loading']) {
      assert.equal(departBlocker({ ...READY, status }), null, status)
    }
  })
})

describe('DEPART_BLOCKER_MESSAGE', () => {
  test('every blocker has copy, and none of it is empty', () => {
    for (const key of ['not_departable', 'no_rider', 'empty'] as const) {
      assert.ok(DEPART_BLOCKER_MESSAGE[key].trim().length > 0, key)
    }
  })

  /** Told as the next action, not as a complaint about current state. */
  test('the copy says what to do', () => {
    assert.match(DEPART_BLOCKER_MESSAGE.no_rider, /assign/i)
    assert.match(DEPART_BLOCKER_MESSAGE.empty, /load/i)
  })
})
