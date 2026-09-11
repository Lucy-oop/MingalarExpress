import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Way history read 0 · 0 · 0 Ks, and every cause was a column the run's own
 * lifecycle clears. None of them would fail a build or any other test: the
 * screen renders, the numbers are simply wrong, and a rider's answer to "what
 * did I earn on Tuesday" is quietly a lie. Source guards are what this repo has
 * instead of a DOM harness.
 */
const ways = readFileSync('lib/rider/ways.ts', 'utf8')
const page = readFileSync('app/rider/ways/page.tsx', 'utf8')
/** Comments discuss every one of these by name, so guard on code only. */
const code = ways.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('way history counts what actually happened', () => {
  /**
   * `receive_trip:148` and `close_trip:302` both null `orders.trip_id` on
   * collections, because every dispatchable pool on the board filters
   * `trip_id is null` — a parcel on the hub shelf must look unattached. So the
   * morning's eight collections became zero the moment the office received the
   * run. `trips.pickup_count` is what banks them (0040).
   */
  test('collections come from the banked count, not from orders.trip_id', () => {
    /*
      ANCHORED TO THE ARITHMETIC, not to the word. The first version of this
      matched /pickup_count/ and passed even with the banked term replaced by a
      literal 0 — because `pickup_count` still appears in the SELECT above.
      Same trap shop-nav.test.ts records: a source guard has to look at the
      expression that does the work.
    */
    assert.match(
      code,
      /const collected\s*=\s*\n?\s*Number\(t\.pickup_count \?\? 0\) \+/,
      'collected no longer adds the banked pickup_count — it will read 0 once the office receives the run',
    )
  })

  /**
   * The asymmetry that makes this work: a DELIVERY-leg parcel that reached the
   * customer is never detached (close_trip only detaches failed parcels and
   * pickups), so deliveries can still be counted live, for good.
   */
  test('deliveries are counted on the delivery leg', () => {
    assert.match(code, /trip_leg === 'delivery' && o\.status === 'delivered'/)
  })

  /**
   * `trips.total_pay` is ZERO on a per_parcel route and always will be:
   * close_trip books its single trip_pay line only on a 'trip' route. Reading
   * it alone showed 0 Ks however much the rider had earned. Every pay line
   * carries trip_id, so the ledger is correct under both models.
   */
  test('pay is summed from the ledger, not read off the trip', () => {
    assert.match(code, /from\('cod_ledger'\)/, 'the ledger is no longer consulted for pay')
    assert.ok(
      !/total_pay/.test(code),
      'trips.total_pay is back — it is 0 on every per_parcel run',
    )
  })

  test('and it sums all three pay kinds', () => {
    for (const kind of ['trip_pay', 'commission_earned', 'pickup_pay']) {
      assert.ok(code.includes(`'${kind}'`), `${kind} is missing from the pay kinds`)
    }
  })

  /** A rider opens this screen to look at the run they are on. */
  test('a run still out is listed', () => {
    assert.match(code, /'departed'/, 'only finished runs are listed again')
  })

  /**
   * Both were unbounded selects over the rider's whole history. PostgREST caps
   * a response at 1000 rows silently, so a busy rider's oldest runs would start
   * reading zero with nothing said.
   */
  test('the per-run reads are scoped to the runs on screen', () => {
    assert.equal(
      (code.match(/\.in\('trip_id', ids\)/g) ?? []).length,
      2,
      'orders and cod_ledger are not both scoped to the listed trips',
    )
  })
})

describe('the card shows both halves of the day', () => {
  test('collections and deliveries each carry their own money', () => {
    assert.match(page, /way\.pickupPay/, 'the pickup earnings are not shown')
    assert.match(page, /way\.deliveryPay/, 'the delivery earnings are not shown')
  })

  /**
   * Expanding a card is what <details> is for. Doing it in React would turn a
   * server-rendered list into a client bundle on the app's lowest-powered
   * screen for one toggle, and it would not work before hydration.
   */
  test('the itemised list needs no javascript', () => {
    assert.match(page, /<details/, 'the parcel list is no longer expandable')
    assert.ok(!/'use client'/.test(page), 'the history page became a client component')
  })

  /** A figure still climbing must not read as a finished total. */
  test('a run still out says so', () => {
    assert.match(page, /ways\.running/, "an in-progress run is presented as though it were done")
  })
})
