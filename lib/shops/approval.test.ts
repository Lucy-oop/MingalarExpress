import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { DICTIONARY } from '@/lib/i18n'
import {
  COD_NEEDS_REVIEW,
  SHOP_BLOCKED_COPY,
  shopApprovalState,
  shopBlockedCopy,
  shopCanUseCod,
  shopUsable,
} from './approval'

/** The English half of a key, for the copy assertions below. */
const en = (key: keyof typeof DICTIONARY) => DICTIONARY[key].en

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
      shopBlockedCopy({ isActive: true, approvedAt: null })?.body,
      shopBlockedCopy({ isActive: false, approvedAt: APPROVED })?.body,
    )
  })

  test('approved then switched off is suspended', () => {
    assert.equal(shopApprovalState({ isActive: false, approvedAt: APPROVED }), 'suspended')
    assert.equal(shopUsable({ isActive: false, approvedAt: APPROVED }), false)
  })

  /**
   * 0031 INVERTED THIS, and the old assertion is worth remembering: an
   * unapproved shop used to be unusable, so a merchant's first day was spent
   * waiting. Approval now gates CASH, not trade.
   */
  test('an unreviewed shop CAN trade', () => {
    assert.equal(shopUsable({ isActive: true, approvedAt: null }), true)
  })

  test('but a suspended one still cannot, reviewed or not', () => {
    assert.equal(shopUsable({ isActive: false, approvedAt: null }), false)
    assert.equal(shopUsable({ isActive: false, approvedAt: APPROVED }), false)
  })

  /**
   * THE HOLE 0031 NEARLY OPENED, caught by the test above failing. These two
   * checks used to be the other way round, so a shop suspended BEFORE it was
   * reviewed reported `awaiting` — and once awaiting could trade, suspending a
   * suspicious new shop would have had no effect at all.
   */
  test('suspending an unreviewed shop actually stops it', () => {
    assert.equal(shopApprovalState({ isActive: false, approvedAt: null }), 'suspended')
    assert.equal(shopUsable({ isActive: false, approvedAt: null }), false)
    assert.equal(shopCanUseCod({ isActive: false, approvedAt: null }), false)
  })

  test('and a rejected one cannot, whatever its active flag says', () => {
    assert.equal(shopUsable({ isActive: true, approvedAt: null, rejectedAt: '2026-09-08' }), false)
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

describe('shopBlockedCopy', () => {
  test('an active shop is given no refusal to show', () => {
    assert.equal(shopBlockedCopy({ isActive: true, approvedAt: APPROVED }), null)
  })

  test('every blocked state has copy, and each one differs', () => {
    const pairs = Object.values(SHOP_BLOCKED_COPY)
    assert.equal(pairs.length, 3)
    assert.equal(new Set(pairs.map((p) => p.body)).size, 3, 'two states share a body')
    assert.equal(new Set(pairs.map((p) => p.title)).size, 3, 'two states share a title')
    for (const { title, body } of pairs) {
      assert.ok(en(title).trim().length > 0, `${title} is blank`)
      assert.ok(en(body).trim().length > 0, `${body} is blank`)
    }
  })

  /**
   * THE BUG THIS MAP EXISTS TO PREVENT. The dashboard used to hardcode the
   * awaiting title for every state, so a suspended shop was headed "Cash on
   * delivery not unlocked yet" over a body saying it could not take orders.
   * Pairing title with body in one place makes that unrepresentable.
   */
  test('each title matches its own body, not the awaiting one', () => {
    assert.match(en(SHOP_BLOCKED_COPY.suspended.title), /suspend/i)
    assert.match(en(SHOP_BLOCKED_COPY.rejected.title), /not approved/i)
    assert.match(en(SHOP_BLOCKED_COPY.awaiting.title), /cash on delivery/i)
  })

  /**
   * An amber alert on a working dashboard reads as a fault, and an `awaiting`
   * shop is working. The tone travels with the copy so the dashboard and the
   * settings page cannot disagree about it — they did, until this moved here.
   */
  test('awaiting is a notice; the other two are warnings', () => {
    assert.equal(shopBlockedCopy({ isActive: true, approvedAt: null })?.tone, 'info')
    assert.equal(shopBlockedCopy({ isActive: false, approvedAt: APPROVED })?.tone, 'warning')
    assert.equal(
      shopBlockedCopy({ isActive: true, approvedAt: null, rejectedAt: '2026-09-08' })?.tone,
      'warning',
    )
  })

  /**
   * The awaiting copy is a NOTICE now, not a refusal, so it has to say what the
   * shop can do rather than what it must wait for — the old wording ("as soon
   * as it is approved") would read as a wall on a screen that is open for
   * business.
   */
  test('the copy points at the right next action', () => {
    assert.match(en(SHOP_BLOCKED_COPY.awaiting.body), /prepaid/i)
    assert.ok(
      !/as soon as it is approved/i.test(en(SHOP_BLOCKED_COPY.awaiting.body)),
      'the awaiting copy still reads as a refusal',
    )
    assert.match(en(SHOP_BLOCKED_COPY.suspended.body), /contact/i)
    assert.match(en(SHOP_BLOCKED_COPY.rejected.body), /contact/i)
  })
})

describe('shopCanUseCod — the bounded exposure', () => {
  /**
   * THE WHOLE POINT OF INSTANT ACCESS BEING SAFE. An unvetted shop booking COD
   * means a rider collects a customer's cash, it lands in cod_ledger against
   * that rider, and the office finds out the shop was fictitious while holding
   * money it owes to nobody. Prepaid moves no money through us.
   */
  test('an unreviewed shop can trade but cannot take cash', () => {
    const fresh = { isActive: true, approvedAt: null }
    assert.equal(shopUsable(fresh), true, 'it must be able to book')
    assert.equal(shopCanUseCod(fresh), false, 'and it must not be able to take cash')
  })

  test('review unlocks it', () => {
    assert.equal(shopCanUseCod({ isActive: true, approvedAt: APPROVED }), true)
  })

  test('suspension takes it away again', () => {
    assert.equal(shopCanUseCod({ isActive: false, approvedAt: APPROVED }), false)
  })

  test('and a rejected shop never had it', () => {
    assert.equal(
      shopCanUseCod({ isActive: true, approvedAt: APPROVED, rejectedAt: '2026-09-08' }),
      false,
    )
  })

  /** The refusal has to name the way forward, or it is just a wall. */
  test('the refusal offers prepaid instead of only saying no', () => {
    assert.match(en(COD_NEEDS_REVIEW), /prepaid/i)
    assert.ok(en(COD_NEEDS_REVIEW).trim().length > 0)
  })

  /**
   * IT IS A KEY NOW, not a sentence. Burmese is the default locale and this was
   * an English literal returned straight out of `createOrder` as a form error.
   */
  test('and it is a dictionary key, so a Burmese shop can read it', () => {
    assert.ok(COD_NEEDS_REVIEW in DICTIONARY, `${COD_NEEDS_REVIEW} is not a real key`)
    assert.notEqual(DICTIONARY[COD_NEEDS_REVIEW].my, DICTIONARY[COD_NEEDS_REVIEW].en)
  })
})
