import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  adjustmentSchema,
  areaSchema,
  coverageSchema,
  pricingSchema,
  riderUpdateSchema,
} from './admin'
import { THINGANGYUN_BBOX } from '@/lib/geo/thingangyun'

const BASE_COVERAGE = {
  bboxSouth: 16.79,
  bboxNorth: 16.89,
  bboxWest: 96.14,
  bboxEast: 96.23,
  mapCenterLat: 16.8409,
  mapCenterLng: 96.1735,
  mapDefaultZoom: 14,
}

const BASE_RIDER = {
  baseAreaId: null,
  coverageKm: '5',
  maxActiveOrders: '3',
  codFloatLimit: '500000',
  vehiclePlate: '',
  commissionPctOverride: null,
}

describe('riderUpdateSchema', () => {
  /**
   * The bug this guards: an untouched <input> submits '' and an omitted one
   * submits null. z.coerce.number() turns BOTH into 0 -- silently putting a
   * rider on a 0% commission override, which assign_order would then snapshot
   * onto every job they take. Blank must mean "follow the global rate".
   */
  for (const blank of ['', null, undefined]) {
    test(`a blank commission override (${JSON.stringify(blank)}) is null, never 0`, () => {
      const r = riderUpdateSchema.safeParse({ ...BASE_RIDER, commissionPctOverride: blank })
      assert.equal(r.success, true)
      assert.equal(r.data?.commissionPctOverride, null)
    })
  }

  test('an explicit 0 override is preserved — it is a real rate', () => {
    const r = riderUpdateSchema.safeParse({ ...BASE_RIDER, commissionPctOverride: '0' })
    assert.equal(r.success, true)
    assert.equal(r.data?.commissionPctOverride, 0)
  })

  test('a set override is coerced to a number', () => {
    const r = riderUpdateSchema.safeParse({ ...BASE_RIDER, commissionPctOverride: '82.5' })
    assert.equal(r.data?.commissionPctOverride, 82.5)
  })

  test('mirrors the SQL CHECK on commission_pct_override (0..100)', () => {
    assert.equal(
      riderUpdateSchema.safeParse({ ...BASE_RIDER, commissionPctOverride: '101' }).success,
      false,
    )
    assert.equal(
      riderUpdateSchema.safeParse({ ...BASE_RIDER, commissionPctOverride: '-1' }).success,
      false,
    )
  })

  test('mirrors the SQL CHECK on coverage_km (0.5..30)', () => {
    assert.equal(riderUpdateSchema.safeParse({ ...BASE_RIDER, coverageKm: '0.4' }).success, false)
    assert.equal(riderUpdateSchema.safeParse({ ...BASE_RIDER, coverageKm: '30.1' }).success, false)
    assert.equal(riderUpdateSchema.safeParse({ ...BASE_RIDER, coverageKm: '30' }).success, true)
  })

  test('mirrors the SQL CHECK on max_active_orders (1..10, whole)', () => {
    assert.equal(riderUpdateSchema.safeParse({ ...BASE_RIDER, maxActiveOrders: '0' }).success, false)
    assert.equal(riderUpdateSchema.safeParse({ ...BASE_RIDER, maxActiveOrders: '11' }).success, false)
    assert.equal(riderUpdateSchema.safeParse({ ...BASE_RIDER, maxActiveOrders: '2.5' }).success, false)
  })

  test('rejects a fractional COD float limit — money is whole kyat', () => {
    assert.equal(riderUpdateSchema.safeParse({ ...BASE_RIDER, codFloatLimit: '5000.5' }).success, false)
  })
})

describe('coverageSchema', () => {
  test('accepts a box inside the geofence', () => {
    assert.equal(coverageSchema.safeParse(BASE_COVERAGE).success, true)
  })

  /**
   * The soft bounds may only ever be NARROWED inside public.in_service_area().
   * Widening them past the CHECK would produce the worst failure available: a
   * map that accepts a pin the database then refuses.
   */
  test('refuses to widen south past the hard geofence', () => {
    const r = coverageSchema.safeParse({
      ...BASE_COVERAGE,
      bboxSouth: THINGANGYUN_BBOX.south - 0.01,
    })
    assert.equal(r.success, false)
  })

  test('refuses to widen north past the hard geofence', () => {
    assert.equal(
      coverageSchema.safeParse({ ...BASE_COVERAGE, bboxNorth: THINGANGYUN_BBOX.north + 0.01 })
        .success,
      false,
    )
  })

  test('refuses to widen west or east past the hard geofence', () => {
    assert.equal(
      coverageSchema.safeParse({ ...BASE_COVERAGE, bboxWest: THINGANGYUN_BBOX.west - 0.01 }).success,
      false,
    )
    assert.equal(
      coverageSchema.safeParse({ ...BASE_COVERAGE, bboxEast: THINGANGYUN_BBOX.east + 0.01 }).success,
      false,
    )
  })

  test('accepts exactly the geofence edges', () => {
    const r = coverageSchema.safeParse({
      ...BASE_COVERAGE,
      bboxSouth: THINGANGYUN_BBOX.south,
      bboxNorth: THINGANGYUN_BBOX.north,
      bboxWest: THINGANGYUN_BBOX.west,
      bboxEast: THINGANGYUN_BBOX.east,
    })
    assert.equal(r.success, true)
  })

  test('rejects an inverted box', () => {
    assert.equal(
      coverageSchema.safeParse({ ...BASE_COVERAGE, bboxSouth: 16.89, bboxNorth: 16.79 }).success,
      false,
    )
    assert.equal(
      coverageSchema.safeParse({ ...BASE_COVERAGE, bboxWest: 96.23, bboxEast: 96.14 }).success,
      false,
    )
  })

  // A home view outside the served box drops every operator on empty tiles.
  test('rejects a base location outside the coverage box', () => {
    const r = coverageSchema.safeParse({ ...BASE_COVERAGE, mapCenterLat: 16.7855 })
    assert.equal(r.success, false)
    assert.equal(r.error?.flatten().fieldErrors.mapCenterLat?.length, 1)
  })

  test('clamps zoom to the usable tile range', () => {
    assert.equal(coverageSchema.safeParse({ ...BASE_COVERAGE, mapDefaultZoom: 9 }).success, false)
    assert.equal(coverageSchema.safeParse({ ...BASE_COVERAGE, mapDefaultZoom: 20 }).success, false)
  })
})

describe('areaSchema', () => {
  const BASE_AREA = { name: 'Thu Mingalar', nameMm: '', sortOrder: '10', isActive: true }

  test('accepts a ward with no centroid', () => {
    const r = areaSchema.safeParse({ ...BASE_AREA, lat: null, lng: null })
    assert.equal(r.success, true)
    assert.equal(r.data?.lat, null)
  })

  // A half-set centroid would write POINT(null …) and fail in Postgres.
  test('rejects a half-set centroid', () => {
    assert.equal(areaSchema.safeParse({ ...BASE_AREA, lat: '16.84', lng: null }).success, false)
    assert.equal(areaSchema.safeParse({ ...BASE_AREA, lat: null, lng: '96.17' }).success, false)
  })

  test('accepts a centroid inside the township', () => {
    const r = areaSchema.safeParse({ ...BASE_AREA, lat: '16.8409', lng: '96.1735' })
    assert.equal(r.success, true)
    assert.equal(r.data?.lat, 16.8409)
  })

  test('accepts a centroid in a township the routes now serve', () => {
    // Downtown (ဆူးလေ). Outside the old Thingangyun-only box, inside the
    // Greater Yangon geofence that migration 0007 widened to.
    assert.equal(areaSchema.safeParse({ ...BASE_AREA, lat: '16.777', lng: '96.159' }).success, true)
  })

  test('rejects a centroid outside Greater Yangon', () => {
    // Bago — a plausible typo, and well beyond anything Routes A–D reach.
    assert.equal(areaSchema.safeParse({ ...BASE_AREA, lat: '17.34', lng: '96.48' }).success, false)
  })

  test('requires a name', () => {
    assert.equal(areaSchema.safeParse({ ...BASE_AREA, name: '   ', lat: null, lng: null }).success, false)
  })
})

describe('pricingSchema', () => {
  const BASE_PRICING = {
    riderCommissionPct: '80',
    defaultCoverageKm: '5',
    minParcelsPerTrip: '20',
    riderPingStaleMin: '10',
    supportPhone: '',
  }

  test('accepts the seeded defaults', () => {
    const r = pricingSchema.safeParse(BASE_PRICING)
    assert.equal(r.success, true)
    assert.equal(r.data?.riderCommissionPct, 80)
    assert.equal(r.data?.supportPhone, null)
  })

  /**
   * The distance knobs (base fee, per-km, free km, road factor) left this schema
   * when shop pricing moved to flat route fees. They are asserted ABSENT rather
   * than simply deleted from the fixture: zod strips unknown keys silently, so
   * without this a well-meaning re-add would validate nothing and write nothing,
   * and the form would look like it worked.
   */
  test('the retired distance knobs are no longer part of the schema', () => {
    const r = pricingSchema.safeParse({
      ...BASE_PRICING,
      baseDeliveryFee: '1500.5',
      perKmFee: '300.25',
      roadFactor: '0.9',
      freeKm: '-4',
    })
    assert.equal(r.success, true, 'unknown keys should be ignored, not validated')
    assert.equal('baseDeliveryFee' in (r.data ?? {}), false)
    assert.equal('roadFactor' in (r.data ?? {}), false)
  })

  test('mirrors the SQL CHECK on min_parcels_per_trip (0..500)', () => {
    assert.equal(pricingSchema.safeParse({ ...BASE_PRICING, minParcelsPerTrip: '-1' }).success, false)
    assert.equal(pricingSchema.safeParse({ ...BASE_PRICING, minParcelsPerTrip: '501' }).success, false)
    assert.equal(pricingSchema.safeParse({ ...BASE_PRICING, minParcelsPerTrip: '20.5' }).success, false)
  })

  // 0 is a legitimate setting, not a validation slip: it switches off the
  // 20-parcel rule while leaving the break-even warning in place.
  test('accepts 0 as "no volume rule"', () => {
    const r = pricingSchema.safeParse({ ...BASE_PRICING, minParcelsPerTrip: '0' })
    assert.equal(r.success, true)
    assert.equal(r.data?.minParcelsPerTrip, 0)
  })

  test('mirrors the SQL CHECK on rider_ping_stale_min (1..120)', () => {
    assert.equal(pricingSchema.safeParse({ ...BASE_PRICING, riderPingStaleMin: '0' }).success, false)
    assert.equal(pricingSchema.safeParse({ ...BASE_PRICING, riderPingStaleMin: '121' }).success, false)
  })

  test('rejects a commission above 100%', () => {
    assert.equal(pricingSchema.safeParse({ ...BASE_PRICING, riderCommissionPct: '101' }).success, false)
  })

  test('normalises a local support number to E.164', () => {
    const r = pricingSchema.safeParse({ ...BASE_PRICING, supportPhone: '09 791 234 567' })
    assert.equal(r.data?.supportPhone, '+959791234567')
  })
})

describe('adjustmentSchema', () => {
  // A real v4 UUID: zod checks the RFC-4122 version and variant nibbles, and so
  // does every id gen_random_uuid() ever produces.
  const RIDER = '11111111-2222-4333-8444-555555555555'
  const BASE_ADJ = { riderId: RIDER, direction: 'owed_by_rider', amount: '5000', memo: 'Short-paid' }

  test('accepts a well-formed adjustment', () => {
    const r = adjustmentSchema.safeParse(BASE_ADJ)
    assert.equal(r.success, true)
    assert.equal(r.data?.amount, 5000)
  })

  // cod_ledger has a CHECK amount <> 0; a zero line is not a correction.
  test('rejects a zero amount', () => {
    assert.equal(adjustmentSchema.safeParse({ ...BASE_ADJ, amount: '0' }).success, false)
  })

  test('rejects fractional kyat', () => {
    assert.equal(adjustmentSchema.safeParse({ ...BASE_ADJ, amount: '500.5' }).success, false)
  })

  // The line is permanent and unreversible except by another line, so a bare
  // "fix" tells whoever reads the ledger in six months nothing at all.
  test('demands a substantive reason', () => {
    assert.equal(adjustmentSchema.safeParse({ ...BASE_ADJ, memo: '' }).success, false)
    assert.equal(adjustmentSchema.safeParse({ ...BASE_ADJ, memo: 'x' }).success, false)
  })

  test('rejects an unknown direction', () => {
    assert.equal(adjustmentSchema.safeParse({ ...BASE_ADJ, direction: 'refund' }).success, false)
  })

  test('rejects a non-uuid rider', () => {
    assert.equal(adjustmentSchema.safeParse({ ...BASE_ADJ, riderId: 'rider-1' }).success, false)
  })
})
