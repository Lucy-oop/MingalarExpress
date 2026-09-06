import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { SETUP_REFUSAL, setupRefusal, type RiderSetupSubject } from './rider-setup-rules'

const rider = (over: Partial<RiderSetupSubject> = {}): RiderSetupSubject => ({
  role: 'rider',
  isActive: true,
  ...over,
})

describe('setupRefusal — who can be handed a working setup link', () => {
  test('an active rider can', () => {
    assert.equal(setupRefusal(rider()), null)
  })

  /**
   * THE ONE THAT MATTERS. A held or suspended rider is inert everywhere else --
   * auth_role() returns NULL for them so every RLS policy fails, and the auth
   * callback refuses to finish the sign-in. Minting anyway would produce a code
   * that fails only after the rider has scanned it at the counter.
   */
  test('a held or suspended rider cannot', () => {
    assert.equal(setupRefusal(rider({ isActive: false })), SETUP_REFUSAL.inactive)
  })

  test('and the refusal says what to do about it', () => {
    assert.match(SETUP_REFUSAL.inactive, /activate/i)
  })

  /**
   * The action is reached with an id from the rider roster, so this should be
   * unreachable -- which is exactly why it is checked. An id is a URL-shaped
   * thing and a server action is a public endpoint.
   */
  test('no other role can, not even an admin', () => {
    for (const role of ['shop_owner', 'dispatcher', 'super_admin'] as const) {
      assert.equal(setupRefusal(rider({ role })), SETUP_REFUSAL.notRider, `${role} was allowed`)
    }
  })

  test('a deleted profile cannot', () => {
    assert.equal(setupRefusal(null), SETUP_REFUSAL.missing)
    assert.equal(setupRefusal(rider({ role: null })), SETUP_REFUSAL.missing)
  })

  /** Being inactive must not be excusable by being some other role. */
  test('inactive and wrong-role is still refused', () => {
    assert.notEqual(setupRefusal({ role: 'dispatcher', isActive: false }), null)
  })

  test('every refusal is a non-empty message', () => {
    for (const [key, message] of Object.entries(SETUP_REFUSAL)) {
      assert.ok(message.trim().length > 0, `${key} is blank`)
    }
  })
})
