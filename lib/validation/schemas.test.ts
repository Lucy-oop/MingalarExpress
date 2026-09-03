import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dbId, orderCreateSchema } from './schemas'

/**
 * `dbId` is deliberately LOOSER than Zod's `.uuid()`. These tests exist to stop
 * someone "fixing" it back to the stricter rule, which would break the app
 * against its own seed data.
 */
describe('dbId — matches what Postgres accepts, not RFC 9562', () => {
  /**
   * Zod 4's `.uuid()` requires the version nibble to be 1-8 and the variant
   * nibble to be 8/9/a/b. Every id below is a valid value for a Postgres `uuid`
   * column and fails that check. They are not hypothetical: these are the ids in
   * supabase/seed.sql, so the strict rule rejected the seeded shop and produced
   * "Select a shop" for a shop the server had resolved correctly.
   */
  const seeded = [
    'aaaaaaaa-0000-0000-0000-000000000001', // the seeded shop
    '33333333-3333-3333-3333-333333333333', // the seeded shop owner
    '44444444-4444-4444-4444-444444444444', // a seeded rider
    '00000000-0000-0000-0000-000000000000', // the nil uuid
  ]

  for (const id of seeded) {
    test(`accepts the seeded id ${id}`, () => {
      assert.equal(dbId().safeParse(id).success, true)
    })
  }

  test('still accepts a gen_random_uuid() v4', () => {
    assert.equal(dbId().safeParse('3f1a9c2e-7b4d-4e8a-9f21-5c6d7e8f9a0b').success, true)
  })

  // Loosening the version/variant rule must not loosen the SHAPE.
  const rejected: Array<[string, string]> = [
    ['not-a-uuid', 'free text'],
    ['aaaaaaaa-0000-0000-0000-00000000000', 'one hex digit short'],
    ['aaaaaaaa-0000-0000-0000-0000000000012', 'one hex digit long'],
    ['aaaaaaaa000000000000000000000001', 'no dashes'],
    ['gggggggg-0000-0000-0000-000000000001', 'non-hex characters'],
    ['', 'empty'],
  ]
  for (const [value, why] of rejected) {
    test(`rejects ${why}`, () => {
      assert.equal(dbId().safeParse(value).success, false)
    })
  }

  test('carries the caller’s message', () => {
    const r = dbId('Select a shop').safeParse('nope')
    assert.equal(r.success, false)
    assert.equal(r.error?.issues[0]?.message, 'Select a shop')
  })

  /**
   * The ids above are only meaningful while the seed actually uses them.
   */
  test('the seeded shop id really is in seed.sql', () => {
    const sql = readFileSync(new URL('../../supabase/seed.sql', import.meta.url), 'utf8')
    assert.ok(sql.includes('aaaaaaaa-0000-0000-0000-000000000001'))
  })
})

describe('orderCreateSchema — a real shop submission', () => {
  /** Exactly the object lib/orders/actions.ts builds, with seeded values. */
  const valid = {
    shopId: 'aaaaaaaa-0000-0000-0000-000000000001',
    pickupAddress: 'No. 24, Thitsar Road, San Pya Ward, Thingangyun, Yangon',
    pickupPoint: { lat: 16.8478, lng: 96.1693 },
    pickupContact: '',
    pickupNote: '',
    customerName: 'Daw Khin Myo',
    customerPhone: '+959791234567',
    customerPhoneAlt: '',
    dropoffAddress: 'Shop 12, Sule Pagoda Road, Kyauktada, Yangon',
    dropoffAreaId: '62a028e5-bcac-457d-889f-d0ea6bb7c728',
    dropoffPoint: { lat: 16.776, lng: 96.158 },
    dropoffNote: '',
    parcelDesc: 'Two coffee cartons',
    parcelWeightG: 1800,
    parcelValue: null,
    isFragile: false,
    paymentMethod: 'cod',
    codAmount: 13500,
    deliveryFee: 0,
    feePayer: 'customer',
  }

  test('the seeded shop passes end to end', () => {
    const r = orderCreateSchema.safeParse(valid)
    assert.equal(r.success, true, JSON.stringify(r.error?.flatten().fieldErrors))
  })

  test('a downtown dropoff is inside the widened geofence', () => {
    // Migration 0007 moved the box out to Greater Yangon; before that this
    // exact point was rejected as "outside Thingangyun Township".
    assert.equal(orderCreateSchema.safeParse(valid).success, true)
  })

  test('a dropoff outside Greater Yangon is still refused', () => {
    const r = orderCreateSchema.safeParse({
      ...valid,
      dropoffPoint: { lat: 21.975, lng: 96.083 }, // Mandalay
    })
    assert.equal(r.success, false)
    assert.ok(r.error!.flatten().fieldErrors.dropoffPoint)
  })

  test('COD with no amount is refused, on the codAmount field', () => {
    const r = orderCreateSchema.safeParse({ ...valid, codAmount: 0 })
    assert.equal(r.success, false)
    assert.ok(r.error!.flatten().fieldErrors.codAmount)
  })

  /**
   * The destination area became REQUIRED with flat-route pricing: it selects the
   * route, and the route sets delivery_fee. An order with no area cannot be
   * priced and could never be loaded onto a run either.
   */
  test('an order with no destination area is refused', () => {
    const { dropoffAreaId: _omitted, ...withoutArea } = valid
    const r = orderCreateSchema.safeParse(withoutArea)
    assert.equal(r.success, false)
    assert.equal(
      r.error!.flatten().fieldErrors.dropoffAreaId?.[0],
      'Choose the destination area',
    )
  })

  test('a null destination area is refused too', () => {
    const r = orderCreateSchema.safeParse({ ...valid, dropoffAreaId: null })
    assert.equal(r.success, false)
    assert.ok(r.error!.flatten().fieldErrors.dropoffAreaId)
  })

  test('a malformed shop id is still refused', () => {
    const r = orderCreateSchema.safeParse({ ...valid, shopId: 'shop-1' })
    assert.equal(r.success, false)
    assert.equal(r.error!.flatten().fieldErrors.shopId?.[0], 'Select a shop')
  })
})

/** The seeded shop, and a stand-in area id: both only need to be valid guids. */
const SEEDED_SHOP = 'aaaaaaaa-0000-0000-0000-000000000001'

describe('orderCreateSchema — the four-field booking form', () => {
  /** Everything the streamlined form actually submits, and nothing else. */
  const minimal = {
    shopId: SEEDED_SHOP,
    pickupAddress: 'No. 24, Thitsar Road, Thingangyun',
    pickupPoint: { lat: 16.8478, lng: 96.1693 },
    customerName: 'Daw Myint',
    customerPhone: '09791234567',
    dropoffAddress: 'Sule Pagoda Road, Kyauktada',
    dropoffAreaId: SEEDED_SHOP,
    dropoffPoint: { lat: 16.776, lng: 96.158 },
    paymentMethod: 'cod' as const,
    codAmount: 45000,
    deliveryFee: 3500,
  }

  test('a booking with no parcel description is accepted', () => {
    const r = orderCreateSchema.safeParse(minimal)
    assert.ok(r.success, JSON.stringify(r.error?.flatten().fieldErrors))
  })

  /**
   * `parcel_desc` is NOT NULL with a 1..500 CHECK, so a blank must not reach
   * Postgres — it would come back as a 23514 with nothing the shop can do.
   */
  test('and it arrives as something the database will accept', () => {
    for (const parcelDesc of [undefined, '', '   ']) {
      const r = orderCreateSchema.safeParse({ ...minimal, parcelDesc })
      assert.ok(r.success, `rejected ${JSON.stringify(parcelDesc)}`)
      assert.ok(r.data.parcelDesc.length >= 1)
      assert.equal(r.data.parcelDesc, 'Parcel')
    }
  })

  test('a description that IS given survives untouched', () => {
    const r = orderCreateSchema.safeParse({ ...minimal, parcelDesc: '  2x coffee cartons  ' })
    assert.ok(r.success)
    assert.equal(r.data.parcelDesc, '2x coffee cartons')
  })

  test('over 500 characters is still refused', () => {
    const r = orderCreateSchema.safeParse({ ...minimal, parcelDesc: 'x'.repeat(501) })
    assert.equal(r.success, false)
  })

  /**
   * The form no longer has a payment-method select: it derives the method from
   * the amount, so these two refinements can never disagree with what the shop
   * typed. Pinned because the pair is what the SQL constraint mirrors.
   */
  test('zero to collect is prepaid, any amount is COD', () => {
    assert.ok(orderCreateSchema.safeParse({ ...minimal, paymentMethod: 'prepaid', codAmount: 0 }).success)
    assert.ok(orderCreateSchema.safeParse({ ...minimal, paymentMethod: 'cod', codAmount: 1 }).success)
  })

  test('the impossible pairs are still refused', () => {
    assert.equal(
      orderCreateSchema.safeParse({ ...minimal, paymentMethod: 'cod', codAmount: 0 }).success,
      false,
    )
    assert.equal(
      orderCreateSchema.safeParse({ ...minimal, paymentMethod: 'prepaid', codAmount: 500 }).success,
      false,
    )
  })
})
