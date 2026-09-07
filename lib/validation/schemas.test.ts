import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dbId, orderCreateSchema,
  shopSetupSchema,
  shopSettingsSchema,
} from './schemas'
import { MAX_MMK } from './limits'
import { codCollectable } from '@/lib/pricing'

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

/**
 * The ceiling guards the GOODS value, not what is stored.
 *
 * `cod_amount` is written as goods + fee when the customer pays the fee, so a
 * parcel at exactly the limit stores MORE than the limit. The schema cannot see
 * that — `deliveryFee` is still a placeholder zero when it runs — which is why
 * `createOrder` re-checks the collectable total once the route fee is known.
 */
describe('orderCreateSchema — where the money ceiling does and does not apply', () => {
  const atCeiling = {
    shopId: SEEDED_SHOP,
    pickupAddress: 'No. 24, Thitsar Road, Thingangyun',
    pickupPoint: { lat: 16.8478, lng: 96.1693 },
    customerName: 'Daw Myint',
    customerPhone: '09791234567',
    dropoffAddress: 'Sule Pagoda Road, Kyauktada',
    dropoffAreaId: SEEDED_SHOP,
    dropoffPoint: { lat: 16.776, lng: 96.158 },
    paymentMethod: 'cod' as const,
    codAmount: MAX_MMK,
    deliveryFee: 0,
  }

  test('goods exactly at the ceiling pass the schema', () => {
    assert.ok(orderCreateSchema.safeParse(atCeiling).success)
  })

  test('one kyat over is refused', () => {
    const r = orderCreateSchema.safeParse({ ...atCeiling, codAmount: MAX_MMK + 1 })
    assert.equal(r.success, false)
  })

  test('but goods + fee can still exceed it — hence the check in createOrder', () => {
    const parsed = orderCreateSchema.safeParse(atCeiling)
    assert.ok(parsed.success)
    // What the action would store for a 3,500 Ks route, before its own guard.
    const stored = codCollectable(parsed.data.codAmount, 3_500, 'customer')
    assert.ok(stored > MAX_MMK, 'the gap this test documents has closed — check createOrder')
    assert.equal(stored, MAX_MMK + 3_500)
  })
})

// ---------------------------------------------------------------------------
// shopSetupSchema — the five fields a merchant fills in to start trading
// ---------------------------------------------------------------------------

describe('shopSetupSchema', () => {
  const BASE = {
    name: 'San Pya Mini Mart',
    goodsType: 'Clothes and bags',
    phone: '09761234567',
    pickupAddress: 'No. 24, Thitsar Road, San Pya Ward, Thingangyun',
    pickupNote: '',
  }

  test('the five typed fields are enough on their own', () => {
    const r = shopSetupSchema.safeParse(BASE)
    assert.equal(r.success, true)
  })

  /**
   * THE ONE THAT MATTERS, and the reason the action writes
   * `formData.get('pickupLat') || undefined`.
   *
   * The location button's hidden inputs are EMPTY STRINGS until it is tapped,
   * and `z.coerce.number()` turns '' into 0 — a real coordinate, in the Gulf of
   * Guinea. Absent has to stay absent, because absent is what makes the server
   * fall back to geocoding the address. Coerced to 0 it would look like a pin
   * the owner placed, fail the service-area check, and block every registration
   * where nobody tapped the button.
   */
  test('an untapped location button leaves the point absent, not zero', () => {
    const r = shopSetupSchema.safeParse({ ...BASE, pickupLat: undefined, pickupLng: undefined })
    assert.equal(r.success, true)
    assert.equal(r.data?.pickupLat, undefined, 'a missing pin must not become lat 0')
    assert.equal(r.data?.pickupLng, undefined)
  })

  test('but a real tap comes through as numbers', () => {
    const r = shopSetupSchema.safeParse({ ...BASE, pickupLat: '16.8478', pickupLng: '96.1693' })
    assert.equal(r.success, true)
    assert.equal(r.data?.pickupLat, 16.8478)
    assert.equal(r.data?.pickupLng, 96.1693)
  })

  test('the pickup note is optional and survives untouched', () => {
    assert.equal(shopSetupSchema.safeParse(BASE).data?.pickupNote, '')
    const r = shopSetupSchema.safeParse({ ...BASE, pickupNote: 'Near the big mall, green shutter' })
    assert.equal(r.data?.pickupNote, 'Near the big mall, green shutter')
  })

  /** 300 to match `shopSettingsSchema.pickupNote`, which edits the same column. */
  test('and it is capped at the same length settings allows', () => {
    assert.equal(shopSetupSchema.safeParse({ ...BASE, pickupNote: 'x'.repeat(300) }).success, true)
    assert.equal(shopSetupSchema.safeParse({ ...BASE, pickupNote: 'x'.repeat(301) }).success, false)
  })

  test('a one-word address is refused — a rider cannot find a shop from "Yangon"', () => {
    assert.equal(shopSetupSchema.safeParse({ ...BASE, pickupAddress: 'Yangon' }).success, false)
  })

  test('what you sell is required, because COD review asks for it by name', () => {
    assert.equal(shopSetupSchema.safeParse({ ...BASE, goodsType: '' }).success, false)
  })
})

// ---------------------------------------------------------------------------
// shopSettingsSchema — a merchant must never be stuck on this screen
// ---------------------------------------------------------------------------

describe('shopSettingsSchema', () => {
  const BASE = {
    name: 'San Pya Mini Mart',
    phone: '09761234567',
    pickupAddress: 'No. 24, Thitsar Road, San Pya Ward, Thingangyun',
    pickupNote: '',
  }

  /**
   * THE POINT OF THE CHANGE. `pickupPoint` was `servicePoint` — required — so a
   * shop with no map coordinates could not save its NAME, its PHONE or its
   * pickup notes either, and the form said so in red. 0034 made the columns
   * nullable so a merchant whose street the geocoder has never heard of is not
   * turned away; this form was the last thing insisting.
   */
  test('saves with a text address and no map pin', () => {
    const r = shopSettingsSchema.safeParse({ ...BASE, pickupPoint: undefined })
    assert.equal(r.success, true)
    assert.equal(r.data?.pickupPoint, undefined)
    assert.equal(r.data?.pickupAddress, BASE.pickupAddress)
  })

  test('and the notes come through with it', () => {
    const r = shopSettingsSchema.safeParse({
      ...BASE,
      pickupNote: 'Near the big mall, green shutter',
      pickupPoint: undefined,
    })
    assert.equal(r.success, true)
    assert.equal(r.data?.pickupNote, 'Near the big mall, green shutter')
  })

  test('a pin that IS given still has to be inside Greater Yangon', () => {
    assert.equal(
      shopSettingsSchema.safeParse({ ...BASE, pickupPoint: { lat: 16.8478, lng: 96.1693 } }).success,
      true,
    )
    // Mandalay.
    assert.equal(
      shopSettingsSchema.safeParse({ ...BASE, pickupPoint: { lat: 21.9588, lng: 96.0891 } }).success,
      false,
    )
  })

  /**
   * THE GULF OF GUINEA, and the bug this pins.
   *
   * `LocationPicker` emits its hidden lat/lng as EMPTY STRINGS when no pin is
   * set, and the action used to build `{ lat: Number(''), lng: Number('') }` —
   * which is `{ lat: 0, lng: 0 }`, a real coordinate off the coast of Africa.
   * So "no pin" arrived as "a pin 8,000 km away" and the shop was told to move
   * a pin it had never placed. The action now passes `undefined`; this asserts
   * that 0,0 is still refused if anyone reintroduces the coercion.
   */
  test('0,0 is a location, not an absence', () => {
    assert.equal(
      shopSettingsSchema.safeParse({ ...BASE, pickupPoint: { lat: 0, lng: 0 } }).success,
      false,
      'lat 0 lng 0 must be refused — it is the Gulf of Guinea, not "unset"',
    )
  })

  test('the address is still required — a rider reads it', () => {
    assert.equal(
      shopSettingsSchema.safeParse({ ...BASE, pickupAddress: '', pickupPoint: undefined }).success,
      false,
    )
  })
})
