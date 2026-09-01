import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseShopStatus,
  shopEditSchema,
  shopOnboardExistingOwnerSchema,
  shopOnboardNewOwnerSchema,
  shopStatusSchema,
} from './admin-shop'

const SHOP_ID = '11111111-2222-4333-8444-555555555555'
const OWNER_ID = '99999999-8888-4777-9666-555555555555'
const AREA_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

/** Inside the Thingangyun geofence (16.785–16.895 N, 96.135–96.235 E). */
const IN_AREA = { lat: '16.8409', lng: '96.1735' }

const CORE = {
  name: 'Shwe Mingalar Store',
  phone: '09 791 234 567',
  areaId: AREA_ID,
  pickupAddress: 'No. 12, Thitsar Road',
  pickupPoint: IN_AREA,
  pickupNote: '',
}

describe('shopStatusSchema', () => {
  /**
   * Suspending a shop locks its owner out of the platform. The reason is the
   * only record of why, and it is written to audit_log, so an unexplained
   * suspension must not be submittable at all.
   */
  test('suspending without a reason is rejected', () => {
    const r = shopStatusSchema.safeParse({
      shopId: SHOP_ID,
      action: 'suspend',
      reason: '',
      detail: '',
    })
    assert.equal(r.success, false)
    assert.deepEqual(r.error?.flatten().fieldErrors.reason, [
      'Choose why this shop is being suspended',
    ])
  })

  test('suspending with a listed reason is accepted', () => {
    const r = shopStatusSchema.safeParse({
      shopId: SHOP_ID,
      action: 'suspend',
      reason: 'unpaid_commission',
      detail: '',
    })
    assert.equal(r.success, true)
    assert.equal(r.data?.reason, 'unpaid_commission')
  })

  // "Other" with no explanation carries exactly as much information as no
  // reason at all, which is the thing this dialog exists to prevent.
  test('“other” demands a detail', () => {
    const bare = shopStatusSchema.safeParse({
      shopId: SHOP_ID,
      action: 'suspend',
      reason: 'other',
      detail: '',
    })
    assert.equal(bare.success, false)
    assert.equal(bare.error?.flatten().fieldErrors.detail?.length, 1)

    const explained = shopStatusSchema.safeParse({
      shopId: SHOP_ID,
      action: 'suspend',
      reason: 'other',
      detail: 'Owner asked us to pause while the shop is rebuilt',
    })
    assert.equal(explained.success, true)
  })

  test('activating needs no reason', () => {
    const r = shopStatusSchema.safeParse({
      shopId: SHOP_ID,
      action: 'activate',
      reason: '',
      detail: '',
    })
    assert.equal(r.success, true)
    assert.equal(r.data?.reason, null)
  })

  test('rejects an unknown reason and an unknown action', () => {
    assert.equal(
      shopStatusSchema.safeParse({
        shopId: SHOP_ID,
        action: 'suspend',
        reason: 'vibes',
        detail: '',
      }).success,
      false,
    )
    assert.equal(
      shopStatusSchema.safeParse({ shopId: SHOP_ID, action: 'delete', reason: '', detail: '' })
        .success,
      false,
    )
  })

  test('rejects a non-uuid shop id', () => {
    assert.equal(
      shopStatusSchema.safeParse({ shopId: 'shop-1', action: 'activate', reason: '', detail: '' })
        .success,
      false,
    )
  })
})

describe('shopEditSchema', () => {
  test('accepts a well-formed shop and normalises the phone', () => {
    const r = shopEditSchema.safeParse(CORE)
    assert.equal(r.success, true)
    assert.equal(r.data?.phone, '+959791234567')
    assert.equal(r.data?.pickupPoint.lat, 16.8409)
  })

  test('a blank ward is null, not an empty string', () => {
    const r = shopEditSchema.safeParse({ ...CORE, areaId: '' })
    assert.equal(r.success, true)
    assert.equal(r.data?.areaId, null)
  })

  /**
   * Mirrors `shops_pickup_in_service_area`. Without this the CHECK rejects the
   * row and the operator gets a 23514 with a constraint name instead of a
   * message pointing at the pin they need to move.
   */
  test('accepts a pickup point in a township the routes now serve', () => {
    // Downtown (ဆူးလေ) is on Route A, so a shop there is legitimate now.
    const r = shopEditSchema.safeParse({ ...CORE, pickupPoint: { lat: '16.777', lng: '96.159' } })
    assert.equal(r.success, true)
  })

  test('rejects a pickup point outside Greater Yangon', () => {
    // Mandalay — the wrong city entirely.
    const r = shopEditSchema.safeParse({ ...CORE, pickupPoint: { lat: '21.97', lng: '96.08' } })
    assert.equal(r.success, false)
  })

  test('rejects a wrong-hemisphere longitude', () => {
    assert.equal(
      shopEditSchema.safeParse({ ...CORE, pickupPoint: { lat: '16.84', lng: '-96.17' } }).success,
      false,
    )
  })

  test('requires a name and a usable address', () => {
    assert.equal(shopEditSchema.safeParse({ ...CORE, name: '   ' }).success, false)
    assert.equal(shopEditSchema.safeParse({ ...CORE, pickupAddress: 'No' }).success, false)
  })

  test('rejects a phone that is not a Myanmar mobile', () => {
    assert.equal(shopEditSchema.safeParse({ ...CORE, phone: '+44 7700 900123' }).success, false)
  })
})

describe('shopOnboardNewOwnerSchema', () => {
  const NEW_OWNER = {
    ...CORE,
    ownerName: 'Daw Thida',
    ownerEmail: 'thida@example.com',
    ownerPhone: '09 400 111 222',
    credential: 'password' as const,
    password: 'correct-horse',
  }

  test('accepts a walk-in registration', () => {
    const r = shopOnboardNewOwnerSchema.safeParse(NEW_OWNER)
    assert.equal(r.success, true)
    assert.equal(r.data?.ownerPhone, '+959400111222')
  })

  test('a short password is rejected in password mode', () => {
    const r = shopOnboardNewOwnerSchema.safeParse({ ...NEW_OWNER, password: 'short' })
    assert.equal(r.success, false)
    assert.equal(r.error?.flatten().fieldErrors.password?.length, 1)
  })

  // Invite mode mints a one-time link instead, so demanding a password there
  // would block the flow on a field the form does not even render.
  test('no password is required in invite mode', () => {
    const r = shopOnboardNewOwnerSchema.safeParse({
      ...NEW_OWNER,
      credential: 'invite',
      password: '',
    })
    assert.equal(r.success, true)
  })

  test('the owner phone is optional and blank becomes null', () => {
    const r = shopOnboardNewOwnerSchema.safeParse({ ...NEW_OWNER, ownerPhone: '' })
    assert.equal(r.success, true)
    assert.equal(r.data?.ownerPhone, null)
  })

  test('rejects a malformed email', () => {
    assert.equal(
      shopOnboardNewOwnerSchema.safeParse({ ...NEW_OWNER, ownerEmail: 'thida@' }).success,
      false,
    )
  })

  test('still enforces the shop geofence', () => {
    assert.equal(
      shopOnboardNewOwnerSchema.safeParse({
        ...NEW_OWNER,
        pickupPoint: { lat: '16.70', lng: '96.17' },
      }).success,
      false,
    )
  })
})

describe('shopOnboardExistingOwnerSchema', () => {
  test('attaches a shop to an existing owner', () => {
    const r = shopOnboardExistingOwnerSchema.safeParse({ ...CORE, ownerId: OWNER_ID })
    assert.equal(r.success, true)
  })

  test('requires a real owner id', () => {
    assert.equal(shopOnboardExistingOwnerSchema.safeParse({ ...CORE, ownerId: '' }).success, false)
    assert.equal(
      shopOnboardExistingOwnerSchema.safeParse({ ...CORE, ownerId: 'owner-1' }).success,
      false,
    )
  })
})

describe('parseShopStatus', () => {
  for (const s of ['active', 'suspended', 'pending']) {
    test(`accepts ${s}`, () => assert.equal(parseShopStatus(s), s))
  }

  // An unrecognised ?status= must fall through to "all", not filter to nothing.
  for (const junk of ['', undefined, 'deleted', 'ACTIVE', 'active;drop']) {
    test(`drops ${JSON.stringify(junk)}`, () => assert.equal(parseShopStatus(junk), undefined))
  }
})
