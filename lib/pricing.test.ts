import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MIN_PARCELS_PER_TRIP, OFFICIAL_ROUTE_FEES, breakEvenParcels, checkTripVolume, codBreakdown, codCollectable, isTripProfitable, pickPayTier, quoteRouteFee, quoteTripPay, routeMargin, splitCommission, type RouteCode, type RoutePayTier, type TripPayRates } from './pricing'

/**
 * The seeded tiers from migration 0007. Boundaries resolve DOWNWARD: 20 parcels
 * is the 20,000 tier, not the 15,000 one.
 */
const TIERS: RoutePayTier[] = [
  { minParcels: 0, maxParcels: 19, basePay: 15_000 },
  { minParcels: 20, maxParcels: 39, basePay: 20_000 },
  { minParcels: 40, maxParcels: null, basePay: 25_000 },
]

const RATES: TripPayRates = { parcelRate: 300, pickupRate: 500 }

const total = (parcels: number, pickups = 0) =>
  quoteTripPay(parcels, pickups, TIERS, RATES).total

describe('pickPayTier', () => {
  /**
   * The source spec contradicted itself here — "အနည်းဆုံး ၂၀ ထုပ် → ၁၅,၀၀၀" and
   * "၂၀ မှ ၄၀ → ၂၀,၀၀၀" cannot both hold at 20. These are the settled
   * boundaries; if the business meant the other reading, the fix is the seeded
   * rows, and these assertions are what will catch the change.
   */
  const cases: Array<[number, number]> = [
    [0, 15_000],
    [19, 15_000],
    [20, 20_000], // the contested boundary
    [39, 20_000],
    [40, 25_000], // the second boundary
    [60, 25_000],
  ]

  for (const [parcels, basePay] of cases) {
    test(`${parcels} parcels -> base ${basePay.toLocaleString()}`, () => {
      assert.equal(pickPayTier(parcels, TIERS)?.basePay, basePay)
    })
  }

  test('the top tier is open-ended, so a heavy run still resolves', () => {
    assert.equal(pickPayTier(500, TIERS)?.basePay, 25_000)
  })

  // The SQL side forbids overlapping ranges outright; this only guarantees the
  // answer does not depend on the order rows came back in.
  test('tier order in the input does not change the answer', () => {
    const shuffled = [TIERS[2]!, TIERS[0]!, TIERS[1]!]
    assert.equal(pickPayTier(25, shuffled)?.basePay, 20_000)
  })

  test('a gap in the tiers yields null rather than a wrong tier', () => {
    const gapped: RoutePayTier[] = [{ minParcels: 40, maxParcels: 60, basePay: 25_000 }]
    assert.equal(pickPayTier(10, gapped), null)
  })
})

describe('quoteTripPay', () => {
  /**
   * The rule that was ambiguous: +300 applies to EVERY parcel, on top of the
   * tier base — not only to parcels above the tier floor. Base and per-parcel
   * both scale with volume.
   */
  test('20 parcels is 26,000 — base 20,000 plus 300 on all twenty', () => {
    const q = quoteTripPay(20, 0, TIERS, RATES)
    assert.equal(q.basePay, 20_000)
    assert.equal(q.parcelPay, 6_000)
    assert.equal(q.total, 26_000)
  })

  test('the per-parcel rate is not charged only above the tier floor', () => {
    // If it were, 20 parcels would pay 20,000 + 0 and 25 would pay 20,000 + 1,500.
    assert.notEqual(total(20), 20_000)
    assert.notEqual(total(25), 21_500)
    assert.equal(total(25), 27_500)
  })

  const table: Array<[number, number, number]> = [
    // parcels, pickups, expected total
    [0, 0, 15_000],
    [19, 0, 20_700],
    [20, 0, 26_000],
    [25, 8, 31_500], // the worked example from the discussion
    [39, 0, 31_700],
    [40, 0, 37_000],
    [60, 0, 43_000],
    [100, 0, 55_000], // open-ended top tier
  ]

  for (const [parcels, pickups, expected] of table) {
    test(`${parcels} parcels + ${pickups} pickups = ${expected.toLocaleString()} Ks`, () => {
      assert.equal(total(parcels, pickups), expected)
    })
  }

  test('pickups are paid at their own rate, on top of everything', () => {
    const q = quoteTripPay(25, 8, TIERS, RATES)
    assert.equal(q.pickupPay, 4_000)
    assert.equal(q.total, q.basePay + q.parcelPay + q.pickupPay)
  })

  test('the returned parts always sum to the total', () => {
    for (const n of [0, 7, 20, 41, 250]) {
      const q = quoteTripPay(n, n % 5, TIERS, RATES)
      assert.equal(q.total, q.basePay + q.parcelPay + q.pickupPay)
    }
  })

  /**
   * Closing a run must not throw. A visible zero base is something an operator
   * can see and correct; an exception aborts the close and strands the trip
   * with cash already collected.
   */
  test('no covering tier gives a zero base, not an exception', () => {
    const q = quoteTripPay(10, 0, [{ minParcels: 40, maxParcels: 60, basePay: 25_000 }], RATES)
    assert.equal(q.tier, null)
    assert.equal(q.basePay, 0)
    assert.equal(q.total, 3_000) // per-parcel still applies
  })

  // Counts are `integer ... check (>= 0)` in the schema; mirror that here rather
  // than trusting a caller.
  test('negative and fractional counts are normalised', () => {
    assert.equal(quoteTripPay(-5, -2, TIERS, RATES).parcels, 0)
    assert.equal(quoteTripPay(20.9, 0, TIERS, RATES).parcels, 20)
    assert.equal(quoteTripPay(Number.NaN, 0, TIERS, RATES).total, 15_000)
  })

  test('money stays whole kyat', () => {
    const q = quoteTripPay(23, 5, TIERS, { parcelRate: 300, pickupRate: 500 })
    for (const v of [q.basePay, q.parcelPay, q.pickupPay, q.total]) {
      assert.equal(Number.isInteger(v), true)
    }
  })
})

describe('routeMargin', () => {
  /**
   * The finding that matters commercially: trip pay makes margin a residual, so
   * the same formula gives wildly different rider shares depending on the flat
   * fee. The 70–80% target only holds near 1,500 Ks per parcel.
   */
  const riderPay = total(25, 8) // 31,500

  test('at 1,500 Ks per parcel the rider takes ~84%', () => {
    const m = routeMargin(25, 1_500, riderPay)
    assert.equal(m.revenue, 37_500)
    assert.equal(m.platform, 6_000)
    assert.equal(m.riderSharePct, 84)
  })

  test('at 3,000 Ks per parcel the rider takes ~42%, not 70–80%', () => {
    const m = routeMargin(25, 3_000, riderPay)
    assert.equal(m.revenue, 75_000)
    assert.equal(m.platform, 43_500)
    assert.equal(m.riderSharePct, 42)
  })

  test('a fee set too low runs the route at a loss, visibly', () => {
    const m = routeMargin(25, 1_000, riderPay)
    assert.equal(m.platform, -6_500)
    assert.ok(m.riderSharePct > 100)
  })

  test('zero revenue does not divide by zero', () => {
    assert.equal(routeMargin(0, 3_000, 15_000).riderSharePct, 0)
  })
})

describe('OFFICIAL_ROUTE_FEES', () => {
  test('matches the official schedule', () => {
    assert.deepEqual(OFFICIAL_ROUTE_FEES, {
      ROUTE_LOCAL: 2500,
      ROUTE_A: 3500,
      ROUTE_B: 3500,
      ROUTE_C: 4000,
      ROUTE_D: 4000,
    })
  })

  /**
   * The database is the source of truth. This reads the seeded INSERT out of
   * migration 0007 and compares, so the TypeScript mirror cannot drift from the
   * rows that actually ship — the failure mode a hand-maintained copy invites.
   */
  test('agrees with the routes seeded in migration 0007', () => {
    const sql = readFileSync(
      new URL('../supabase/migrations/20260825090700_routes.sql', import.meta.url),
      'utf8',
    )
    for (const [code, fee] of Object.entries(OFFICIAL_ROUTE_FEES)) {
      // ('ROUTE_A', 'Route A — …', …, 'trip', 3500, 10)
      const row = new RegExp(`'${code}',[\\s\\S]{0,220}?'trip',\\s*(\\d+)`).exec(sql)
      assert.ok(row, `${code} not found in the migration's routes insert`)
      assert.equal(Number(row![1]), fee, `${code} fee differs between SQL and TypeScript`)
    }
  })

  test('every route the fee table names is trip-paid', () => {
    assert.equal(Object.keys(OFFICIAL_ROUTE_FEES).length, 5)
  })
})

describe('quoteRouteFee', () => {
  test('is a flat multiple, no distance component', () => {
    assert.equal(quoteRouteFee(25, OFFICIAL_ROUTE_FEES.ROUTE_A), 87_500)
    assert.equal(quoteRouteFee(0, OFFICIAL_ROUTE_FEES.ROUTE_D), 0)
  })
})

describe('breakEvenParcels — the small-run trap', () => {
  /**
   * Trip pay opens with a flat 15,000 base, so a short run is paid more than it
   * earns. These are the counts a dispatcher needs to know before sending a
   * half-empty run out.
   */
  const cases: Array<[RouteCode, number]> = [
    ['ROUTE_LOCAL', 7], // 2,500 Ks — the thinnest margin, so the highest floor
    ['ROUTE_A', 5],
    ['ROUTE_B', 5],
    ['ROUTE_C', 5],
    ['ROUTE_D', 5],
  ]

  for (const [code, expected] of cases) {
    test(`${code} breaks even at ${expected} parcels`, () => {
      assert.equal(breakEvenParcels(OFFICIAL_ROUTE_FEES[code], TIERS, RATES), expected)
    })
  }

  test('a local run below break-even really does lose money', () => {
    const pay = total(6)
    const m = routeMargin(6, OFFICIAL_ROUTE_FEES.ROUTE_LOCAL, pay)
    assert.equal(pay, 16_800)
    assert.equal(m.revenue, 15_000)
    assert.equal(m.platform, -1_800)
  })

  // The base is a step function, so a tier jump could in principle push a
  // profitable run back into loss. With this schedule none does; if a tier or a
  // fee changes so that one can, this is the test that says so.
  test('no route dips back into loss at a tier boundary', () => {
    for (const fee of Object.values(OFFICIAL_ROUTE_FEES)) {
      const floor = breakEvenParcels(fee, TIERS, RATES)!
      for (let n = floor; n <= 120; n += 1) {
        const m = routeMargin(n, fee, total(n))
        assert.ok(m.platform >= 0, `fee ${fee} goes negative again at ${n} parcels`)
      }
    }
  })
})

describe('rider share under the official schedule', () => {
  /**
   * Recorded because the stated target was 70–80% to the rider. Under the signed
   * -off fees a full run pays the rider roughly a third, and the platform keeps
   * the rest. Not a bug — but it is a decision, and it should be visible.
   */
  const cases: Array<[RouteCode, number, number]> = [
    // route, parcels, rider share %
    ['ROUTE_LOCAL', 25, 44],
    ['ROUTE_A', 25, 31.4],
    ['ROUTE_C', 25, 27.5],
  ]

  for (const [code, parcels, share] of cases) {
    test(`${code} at ${parcels} parcels pays the rider ~${share}%`, () => {
      const m = routeMargin(parcels, OFFICIAL_ROUTE_FEES[code], total(parcels))
      assert.equal(m.riderSharePct, share)
    })
  }
})

describe('splitCommission (per-parcel routes are unchanged)', () => {
  test('still floors the rider cut so the split sums to the fee exactly', () => {
    const s = splitCommission(2_999, 80)
    assert.equal(s.rider + s.platform, 2_999)
    assert.equal(s.rider, 2_399)
  })
})

describe('pickPayTier — route overrides', () => {
  const LOCAL_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  const OTHER_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'

  /** A local override that pays less on short runs, alongside the globals. */
  const WITH_OVERRIDE: RoutePayTier[] = [
    ...TIERS,
    { minParcels: 0, maxParcels: 19, basePay: 8_000, routeId: LOCAL_ID },
  ]

  test('a route-specific tier beats the global one for that route', () => {
    assert.equal(pickPayTier(10, WITH_OVERRIDE, LOCAL_ID)?.basePay, 8_000)
  })

  test('other routes still get the global tier', () => {
    assert.equal(pickPayTier(10, WITH_OVERRIDE, OTHER_ID)?.basePay, 15_000)
  })

  test('with no route given, the global tier wins', () => {
    assert.equal(pickPayTier(10, WITH_OVERRIDE)?.basePay, 15_000)
    assert.equal(pickPayTier(10, WITH_OVERRIDE, null)?.basePay, 15_000)
  })

  test('an override only covers the range it declares', () => {
    // The override stops at 19; 25 falls through to the global 20–39 tier.
    assert.equal(pickPayTier(25, WITH_OVERRIDE, LOCAL_ID)?.basePay, 20_000)
  })

  test('quoteTripPay threads the route through', () => {
    assert.equal(quoteTripPay(10, 0, WITH_OVERRIDE, RATES, LOCAL_ID).total, 11_000)
    assert.equal(quoteTripPay(10, 0, WITH_OVERRIDE, RATES).total, 18_000)
  })

  test('a route with only an override and no covering global yields null', () => {
    const sparse: RoutePayTier[] = [
      { minParcels: 40, maxParcels: null, basePay: 25_000, routeId: LOCAL_ID },
    ]
    assert.equal(pickPayTier(10, sparse, LOCAL_ID), null)
  })
})

describe('checkTripVolume — the 20-parcel rule', () => {
  const FEE: number = OFFICIAL_ROUTE_FEES.ROUTE_A // 3,500
  // `fee: number`, not an inferred literal: OFFICIAL_ROUTE_FEES is `as const`, so
  // an inferred default would narrow the parameter to exactly 3500.
  const check = (n: number, fee: number = FEE) => checkTripVolume(n, fee, TIERS, RATES)

  test('a full run is ok and says nothing', () => {
    const c = check(25)
    assert.equal(c.severity, 'ok')
    assert.equal(c.meetsMinimum, true)
    assert.equal(c.message, null)
  })

  test('exactly 20 parcels meets the minimum', () => {
    assert.equal(check(20).severity, 'ok')
    assert.equal(check(19).severity, 'below_minimum')
  })

  test('the banner reads as specified', () => {
    assert.equal(check(14).message, 'Under Minimum Volume: 14/20 Parcels')
  })

  /**
   * The distinction that matters: a 14-parcel Route A run is BELOW MINIMUM but
   * still makes money. Calling it unprofitable would be a lie, and a warning
   * that lies gets ignored at 6 parcels too.
   */
  test('below minimum is not the same as unprofitable', () => {
    const c = check(14)
    assert.equal(c.meetsMinimum, false)
    assert.equal(c.profitable, true)
    assert.ok(c.margin.platform > 0)
    assert.equal(c.severity, 'below_minimum')
  })

  test('an actual loss outranks the minimum warning', () => {
    const c = check(3)
    assert.equal(c.profitable, false)
    assert.equal(c.severity, 'loss')
    assert.match(c.message!, /Running at a loss: 3\/20 parcels/)
  })

  test('reports the route break-even alongside', () => {
    assert.equal(check(10, OFFICIAL_ROUTE_FEES.ROUTE_LOCAL).breakEven, 7)
    assert.equal(check(10).breakEven, 5)
  })
})

describe('isTripProfitable', () => {
  const ROUTE_A_ID = 'cccccccc-3333-4333-8333-cccccccccccc'
  const ctx = {
    routes: [{ id: ROUTE_A_ID, perParcelFee: OFFICIAL_ROUTE_FEES.ROUTE_A }],
    tiers: TIERS,
    rates: RATES,
  }

  test('true once revenue covers the rider pay', () => {
    assert.equal(isTripProfitable(5, ROUTE_A_ID, ctx), true)
    assert.equal(isTripProfitable(25, ROUTE_A_ID, ctx), true)
  })

  test('false below break-even', () => {
    assert.equal(isTripProfitable(4, ROUTE_A_ID, ctx), false)
  })

  // It answers the money question only; the 20-parcel rule is checkTripVolume's.
  test('a below-minimum run that still makes money is profitable', () => {
    assert.equal(isTripProfitable(12, ROUTE_A_ID, ctx), true)
  })

  test('an unknown route cannot be shown profitable', () => {
    assert.equal(isTripProfitable(50, 'dddddddd-4444-4444-8444-dddddddddddd', ctx), false)
  })
})

/**
 * SQL/TypeScript parity for the numbers that are NOT in OFFICIAL_ROUTE_FEES.
 *
 * Every figure below exists twice — once as a seeded row or column default, once
 * as a TypeScript constant — and nothing but these assertions stops the two
 * drifting. Migration 0008's suite (`supabase/tests/route_flow.sql`) asserts the
 * same totals from the database side, so a change in either place breaks a test
 * somewhere rather than quietly repricing a rider.
 */
describe('parity with the migrations', () => {
  const routesSql = readFileSync(
    new URL('../supabase/migrations/20260825090700_routes.sql', import.meta.url),
    'utf8',
  )
  const tripsSql = readFileSync(
    new URL('../supabase/migrations/20260825090800_trips_rpc.sql', import.meta.url),
    'utf8',
  )

  test('TIERS matches the route_pay_tiers seeded in 0007', () => {
    // (null,  0, 19,   15000),
    // (null, 20, 39,   20000),
    // (null, 40, null, 25000)
    const block = /insert into public\.route_pay_tiers[\s\S]*?;/.exec(routesSql)
    assert.ok(block, 'no route_pay_tiers seed found in 0007')

    const rows = [...block[0].matchAll(/\(\s*null,\s*(\d+),\s*(\d+|null),\s*(\d+)\s*\)/g)].map(
      (m) => ({
        minParcels: Number(m[1]),
        maxParcels: m[2] === 'null' ? null : Number(m[2]),
        basePay: Number(m[3]),
      }),
    )
    assert.deepEqual(rows, TIERS, 'seeded pay tiers differ from the TypeScript mirror')
  })

  test('RATES matches the app_settings defaults in 0007', () => {
    const parcel = /route_parcel_rate\s+bigint\s+not null\s+default\s+(\d+)/.exec(routesSql)
    const pickup = /route_pickup_rate\s+bigint\s+not null\s+default\s+(\d+)/.exec(routesSql)
    assert.ok(parcel && pickup, 'per-unit rate defaults not found in 0007')
    assert.equal(Number(parcel![1]), RATES.parcelRate)
    assert.equal(Number(pickup![1]), RATES.pickupRate)
  })

  /**
   * The database is authoritative at runtime: depart_trip() reads
   * app_settings.min_parcels_per_trip, so ops can move the rule without a
   * deploy. MIN_PARCELS_PER_TRIP is the shipped default, and this pins the two
   * together so the banner never warns at a different count from the one the
   * gate enforces on the day it ships.
   */
  test('MIN_PARCELS_PER_TRIP matches the min_parcels_per_trip default in 0008', () => {
    const m = /min_parcels_per_trip\s+smallint\s+not null\s+default\s+(\d+)/.exec(tripsSql)
    assert.ok(m, 'min_parcels_per_trip default not found in 0008')
    assert.equal(Number(m![1]), MIN_PARCELS_PER_TRIP)
  })
})

/**
 * The board reads `app_settings.min_parcels_per_trip` and passes it in, because
 * `depart_trip()` reads that same column. If the banner used the constant while
 * ops had moved the setting, a dispatcher would be told a run is fine and then
 * refused when they tried to send it — the exact mismatch the shared threshold
 * is supposed to prevent.
 */
describe('checkTripVolume — a tunable minimum', () => {
  const FEE = OFFICIAL_ROUTE_FEES.ROUTE_A as number
  const check = (parcels: number, minimum?: number) =>
    checkTripVolume(parcels, FEE, TIERS, RATES, null, minimum)

  test('defaults to MIN_PARCELS_PER_TRIP when not given', () => {
    assert.equal(check(19).minimum, MIN_PARCELS_PER_TRIP)
    assert.equal(check(19).severity, 'below_minimum')
    assert.equal(check(20).severity, 'ok')
  })

  test('a lowered setting moves the boundary', () => {
    assert.equal(check(15, 15).severity, 'ok')
    assert.equal(check(14, 15).severity, 'below_minimum')
  })

  test('a raised setting moves it the other way', () => {
    assert.equal(check(20, 30).severity, 'below_minimum')
    assert.equal(check(30, 30).severity, 'ok')
  })

  test('the message quotes the live minimum, not the constant', () => {
    assert.equal(check(14, 30).message, 'Under Minimum Volume: 14/30 Parcels')
  })

  test('a minimum of 0 disables the rule without disabling the loss check', () => {
    assert.equal(check(25, 0).severity, 'ok')
    // 3 parcels still cannot pay for itself, and that is not a tunable opinion.
    assert.equal(check(3, 0).severity, 'loss')
  })

  test('loss still outranks below_minimum whatever the setting', () => {
    const c = check(3, 30)
    assert.equal(c.severity, 'loss')
    assert.equal(c.meetsMinimum, false)
  })

  test('a nonsense minimum is clamped rather than trusted', () => {
    assert.equal(check(5, -10).minimum, 0)
    assert.equal(check(20, 20.7).minimum, 20)
  })
})

describe('codBreakdown — what the rider collects, and why', () => {
  /**
   * THE ONE THAT WOULD COST REAL MONEY. `cod_amount` already contains the
   * delivery fee, so showing "delivery fee + COD" as a sum tells the rider to
   * collect the fee twice. The breakdown must sum back to cod_amount exactly.
   */
  test('customer pays the fee: the parts sum to cod_amount, not more', () => {
    const b = codBreakdown(48_500, 3_500, 'customer')
    assert.equal(b.goods, 45_000)
    assert.equal(b.fee, 3_500)
    assert.equal(b.total, 48_500)
    assert.equal(b.goods + b.fee, b.total)
    assert.equal(b.feeFromCustomer, true)
  })

  test('and it is the exact inverse of codCollectable', () => {
    for (const [goods, fee] of [
      [45_000, 3_500],
      [0, 2_500],
      [1_000_000, 6_000],
    ] as Array<[number, number]>) {
      const total = codCollectable(goods, fee, 'customer')
      const b = codBreakdown(total, fee, 'customer')
      assert.equal(b.goods, goods)
      assert.equal(b.total, total)
    }
  })

  /** The shop pays: the rider takes goods only, and must not ask for the fee. */
  test('shop pays the fee: the rider collects goods only', () => {
    const b = codBreakdown(45_000, 3_500, 'shop')
    assert.equal(b.goods, 45_000)
    assert.equal(b.fee, 0)
    assert.equal(b.total, 45_000)
    assert.equal(b.feeFromCustomer, false)
  })

  test('prepaid collects nothing at all', () => {
    const b = codBreakdown(0, 3_500, 'customer', 'prepaid')
    assert.equal(b.total, 0)
    assert.equal(b.goods, 0)
  })

  /** A fee raised after pricing must not render a negative goods value. */
  test('a fee larger than the total clamps rather than going negative', () => {
    const b = codBreakdown(2_000, 3_500, 'customer')
    assert.equal(b.goods, 0)
    assert.ok(b.goods >= 0)
  })
})
