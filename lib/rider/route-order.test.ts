import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_HUB, sortRoute, type Routable } from './route-order'

/** Real Yangon points, at increasing distance from the Thingangyun hub. */
const NEAR = { lat: 16.8478, lng: 96.1693 } // Thitsar Road, ~1 km
const MID = { lat: 16.8100, lng: 96.1500 } // Bahan-ish, ~5 km
const FAR = { lat: 16.7760, lng: 96.1580 } // Kyauktada / Sule, ~8 km
const FARTHEST = { lat: 17.0000, lng: 96.1300 } // Mingaladon, ~18 km

const job = (code: string, leg: Routable['leg'], destination: Routable['destination']): Routable => ({
  id: code,
  code,
  leg,
  destination,
})

const codes = (jobs: Array<{ code: string }>) => jobs.map((j) => j.code)

describe('sortRoute — deliveries go outwards', () => {
  test('nearest the hub first', () => {
    const out = sortRoute([
      job('D-FAR', 'delivery', FAR),
      job('D-NEAR', 'delivery', NEAR),
      job('D-MID', 'delivery', MID),
    ])
    assert.deepEqual(codes(out), ['D-NEAR', 'D-MID', 'D-FAR'])
  })

  test('and the distances it sorted on are attached, ascending', () => {
    const out = sortRoute([job('B', 'delivery', FAR), job('A', 'delivery', NEAR)])
    assert.ok(out[0]!.hubKm! < out[1]!.hubKm!)
    assert.ok(out[0]!.hubKm! < 3, `expected ~1 km, got ${out[0]!.hubKm}`)
  })
})

describe('sortRoute — pickups come back in', () => {
  /**
   * THE POINT OF THE WHOLE FUNCTION. Collections sorted outwards would end the
   * day at the far edge of the city holding every collected parcel and the whole
   * day's COD — the longest ride home, carrying the most cash.
   */
  test('farthest first, finishing beside the hub', () => {
    const out = sortRoute([
      job('P-NEAR', 'pickup', NEAR),
      job('P-FARTHEST', 'pickup', FARTHEST),
      job('P-MID', 'pickup', MID),
    ])
    assert.deepEqual(codes(out), ['P-FARTHEST', 'P-MID', 'P-NEAR'])
  })

  test('a return rides home with the collections', () => {
    const out = sortRoute([
      job('R-NEAR', 'return', NEAR),
      job('R-FAR', 'return', FAR),
    ])
    assert.deepEqual(codes(out), ['R-FAR', 'R-NEAR'])
  })
})

describe('sortRoute — the loop', () => {
  test('every delivery comes before every collection', () => {
    const out = sortRoute([
      job('P-FAR', 'pickup', FAR),
      job('D-FAR', 'delivery', FAR),
      job('P-NEAR', 'pickup', NEAR),
      job('D-NEAR', 'delivery', NEAR),
      job('R-MID', 'return', MID),
    ])
    assert.deepEqual(codes(out), ['D-NEAR', 'D-FAR', 'P-FAR', 'R-MID', 'P-NEAR'])
  })

  test('stop numbers run 1..n across the whole run, with no gaps', () => {
    const out = sortRoute([
      job('P1', 'pickup', FAR),
      job('D1', 'delivery', NEAR),
      job('D2', 'delivery', MID),
    ])
    assert.deepEqual(
      out.map((j) => j.stopNumber),
      [1, 2, 3],
    )
  })
})

describe('sortRoute — bad and missing data', () => {
  /** A rider must never lose a stop because a pin is missing. */
  test('a parcel with no coordinates keeps its place, at the end of its group', () => {
    const out = sortRoute([
      job('D-NOWHERE', 'delivery', null),
      job('D-NEAR', 'delivery', NEAR),
      job('P-NOWHERE', 'pickup', null),
      job('P-FAR', 'pickup', FAR),
    ])
    assert.deepEqual(codes(out), ['D-NEAR', 'D-NOWHERE', 'P-FAR', 'P-NOWHERE'])
    assert.equal(out.length, 4)
    assert.equal(out[1]!.hubKm, null)
  })

  test('two parcels at the same spot keep a stable order', () => {
    const a = sortRoute([job('B', 'delivery', NEAR), job('A', 'delivery', NEAR)])
    const b = sortRoute([job('A', 'delivery', NEAR), job('B', 'delivery', NEAR)])
    assert.deepEqual(codes(a), codes(b))
    assert.deepEqual(codes(a), ['A', 'B'])
  })

  test('an empty run sorts to an empty run', () => {
    assert.deepEqual(sortRoute([]), [])
  })

  test('the hub can be overridden per run', () => {
    // Measured from Mingaladon instead, the order inverts.
    const out = sortRoute([job('NEAR-TGY', 'delivery', NEAR), job('FAR-TGY', 'delivery', FARTHEST)], FARTHEST)
    assert.deepEqual(codes(out), ['FAR-TGY', 'NEAR-TGY'])
  })

  test('the default hub really is Thingangyun', () => {
    assert.ok(Math.abs(DEFAULT_HUB.lat - 16.84) < 0.02)
    assert.ok(Math.abs(DEFAULT_HUB.lng - 96.17) < 0.02)
  })
})

describe('an unpinned run is still a route', () => {
  /**
   * 0037 made the dropoff pin optional, so a run of parcels the geocoder could
   * not place has no coordinates to measure. Ordered by order code that is not
   * a route, it is a list — so `sortRoute` falls back to `route_areas.stop_order`,
   * the ward sequence the office chose for this route.
   */
  const j = (code: string, stopOrder: number | null) => ({
    id: code,
    code,
    leg: 'delivery' as const,
    destination: null,
    stopOrder,
  })

  test('unmeasurable stops follow the office ward sequence, not the code', () => {
    const out = sortRoute([j('MGE-C', 1), j('MGE-A', 3), j('MGE-B', 2)])
    assert.deepEqual(
      out.map((o) => o.code),
      ['MGE-C', 'MGE-B', 'MGE-A'],
      'the drive order should be the ward sequence 1,2,3 — not alphabetical',
    )
  })

  test('and the code only breaks a genuine tie', () => {
    const out = sortRoute([j('MGE-B', 2), j('MGE-A', 2)])
    assert.deepEqual(
      out.map((o) => o.code),
      ['MGE-A', 'MGE-B'],
      'equal stop orders must stay stable between refreshes',
    )
  })

  test('a stop with no ward sequence at all sorts after ones that have it', () => {
    const out = sortRoute([j('MGE-A', null), j('MGE-B', 9)])
    assert.deepEqual(out.map((o) => o.code), ['MGE-B', 'MGE-A'])
  })

  /**
   * THE RULE THAT MUST NOT REGRESS. A measured stop goes in its right place; an
   * unmeasured one keeps its place at the END of its group. A rider must never
   * lose a stop, and an unplaceable parcel must never jump the queue.
   */
  test('a pinned stop still outranks an unpinned one', () => {
    const near = { id: 'n', code: 'MGE-Z', leg: 'delivery' as const, destination: { lat: 16.8409, lng: 96.1735 }, stopOrder: 99 }
    const out = sortRoute([j('MGE-A', 1), near])
    assert.deepEqual(
      out.map((o) => o.code),
      ['MGE-Z', 'MGE-A'],
      'the measurable stop must come first even with a worse stop_order',
    )
  })
})
