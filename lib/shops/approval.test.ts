import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SHOP_BLOCKED_MESSAGE,
  shopApprovalState,
  shopBlockedMessage,
  shopUsable,
} from './approval'

const APPROVED = '2026-09-05T10:00:00Z'

describe('shopApprovalState', () => {
  test('approved and switched on is the only usable state', () => {
    assert.equal(shopApprovalState({ isActive: true, approvedAt: APPROVED }), 'active')
    assert.equal(shopUsable({ isActive: true, approvedAt: APPROVED }), true)
  })

  /**
   * THE DISTINCTION THIS MODULE EXISTS FOR. A brand-new shop and a suspended
   * one are both "cannot book", and telling either the other's story sends the
   * owner to do the wrong thing -- wait, versus ring the office.
   */
  test('never approved is awaiting, not suspended', () => {
    assert.equal(shopApprovalState({ isActive: true, approvedAt: null }), 'awaiting')
    assert.notEqual(
      shopBlockedMessage({ isActive: true, approvedAt: null }),
      shopBlockedMessage({ isActive: false, approvedAt: APPROVED }),
    )
  })

  test('approved then switched off is suspended', () => {
    assert.equal(shopApprovalState({ isActive: false, approvedAt: APPROVED }), 'suspended')
    assert.equal(shopUsable({ isActive: false, approvedAt: APPROVED }), false)
  })

  /** An unapproved shop cannot book however `is_active` happens to read. */
  test('not approved is not usable, active flag notwithstanding', () => {
    assert.equal(shopUsable({ isActive: true, approvedAt: null }), false)
    assert.equal(shopUsable({ isActive: false, approvedAt: null }), false)
  })

  /**
   * Rejection is the final word. Reporting it as "awaiting" would leave the
   * shop waiting for an answer that has already been given.
   */
  test('rejection outranks everything', () => {
    assert.equal(
      shopApprovalState({ isActive: true, approvedAt: APPROVED, rejectedAt: '2026-09-06' }),
      'rejected',
    )
    assert.equal(
      shopApprovalState({ isActive: true, approvedAt: null, rejectedAt: '2026-09-06' }),
      'rejected',
    )
  })
})

describe('shopBlockedMessage', () => {
  test('an active shop is given no refusal to show', () => {
    assert.equal(shopBlockedMessage({ isActive: true, approvedAt: APPROVED }), null)
  })

  test('every blocked state has copy, and each one differs', () => {
    const msgs = Object.values(SHOP_BLOCKED_MESSAGE)
    assert.equal(msgs.length, 3)
    assert.equal(new Set(msgs).size, 3, 'two states share a message')
    for (const m of msgs) assert.ok(m.trim().length > 0)
  })

  /** The waiting shop is told to wait; the suspended one to ring the office. */
  test('the copy points at the right next action', () => {
    assert.match(SHOP_BLOCKED_MESSAGE.awaiting, /waiting|confirm/i)
    assert.match(SHOP_BLOCKED_MESSAGE.suspended, /contact/i)
    assert.match(SHOP_BLOCKED_MESSAGE.rejected, /contact/i)
  })
})
