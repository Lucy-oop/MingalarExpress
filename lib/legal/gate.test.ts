import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { isScrolledToEnd, shouldBlock, type AcceptanceRead } from './gate'
import { COD_ADVANCE_POLICY_VERSION } from './cod-advance'

describe('shouldBlock', () => {
  test('never accepted — stop them', () => {
    assert.equal(shouldBlock({ status: 'none' }), true)
  })

  test('accepted this wording — let them through', () => {
    assert.equal(shouldBlock({ status: 'accepted', version: COD_ADVANCE_POLICY_VERSION }), false)
  })

  test('accepted superseded wording — ask again', () => {
    assert.equal(shouldBlock({ status: 'accepted', version: '2026-01-01' }), true)
    assert.equal(shouldBlock({ status: 'accepted', version: '2026-09-05' }, '2026-12-01'), true)
  })

  /**
   * THE LOCKOUT GUARD, and the reason this is a function rather than an
   * expression in a layout.
   *
   * The read fails for reasons that have nothing to do with the shop — the
   * table missing because migration 0023 has not been pushed, a transient
   * connection error. Behind a hard gate, treating that as "not accepted"
   * blocks EVERY shop from EVERY page at once, and the Continue button fails
   * for the same reason the read did, so nobody can get out.
   *
   * If a refactor ever flips this to `true`, that is what ships.
   */
  test('the read FAILED — let them through, never block on ignorance', () => {
    assert.equal(shouldBlock({ status: 'unknown' }), false)
    assert.equal(shouldBlock({ status: 'unknown' }, 'any-version'), false)
  })

  test('"not accepted" and "could not tell" are opposite answers', () => {
    const none: AcceptanceRead = { status: 'none' }
    const unknown: AcceptanceRead = { status: 'unknown' }
    assert.notEqual(shouldBlock(none), shouldBlock(unknown))
  })
})

describe('isScrolledToEnd', () => {
  test('at the top of a long document', () => {
    assert.equal(isScrolledToEnd(0, 400, 2000), false)
  })

  test('halfway', () => {
    assert.equal(isScrolledToEnd(800, 400, 2000), false)
  })

  test('at the bottom exactly', () => {
    assert.equal(isScrolledToEnd(1600, 400, 2000), true)
  })

  /**
   * scrollTop is fractional on a zoomed or high-DPI display, so an exact match
   * is rare in practice. Without slack the checkbox would never enable for
   * those users and nothing on screen would explain why.
   */
  test('a few pixels short still counts', () => {
    assert.equal(isScrolledToEnd(1580, 400, 2000), true)
    assert.equal(isScrolledToEnd(1599.6237, 400.128, 2000.51), true)
  })

  test('but genuinely unread does not', () => {
    assert.equal(isScrolledToEnd(1400, 400, 2000), false)
  })

  /**
   * THE OTHER LOCKOUT. A document shorter than its container has no bottom to
   * scroll to — on a tall desktop window, or if the text is ever shortened.
   * Requiring a scroll there makes the terms impossible to accept.
   */
  test('content shorter than the container is already read', () => {
    assert.equal(isScrolledToEnd(0, 800, 400), true)
    assert.equal(isScrolledToEnd(0, 400, 400), true)
  })

  test('unmeasurable geometry does not strand the reader', () => {
    assert.equal(isScrolledToEnd(NaN, 400, 2000), true)
    assert.equal(isScrolledToEnd(0, NaN, 2000), true)
    assert.equal(isScrolledToEnd(0, 400, Infinity), true)
  })

  test('the slack is adjustable, and honoured', () => {
    assert.equal(isScrolledToEnd(1500, 400, 2000, 0), false)
    assert.equal(isScrolledToEnd(1500, 400, 2000, 100), true)
  })
})
