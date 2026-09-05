import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COD_ADVANCE_POLICY,
  COD_ADVANCE_POLICY_KEY,
  COD_ADVANCE_POLICY_VERSION,
  needsAcceptance,
} from './cod-advance'

describe('needsAcceptance', () => {
  test('never accepted', () => {
    assert.equal(needsAcceptance(null), true)
    assert.equal(needsAcceptance(undefined), true)
  })

  test('accepted the current wording', () => {
    assert.equal(needsAcceptance(COD_ADVANCE_POLICY_VERSION), false)
  })

  /**
   * THE REASON THE VERSION COLUMN EXISTS. Agreeing to the September text is not
   * agreeing to whatever replaces it, so a bump has to re-ask — otherwise
   * changing terms that carry liability would happen silently behind an
   * acceptance nobody gave.
   */
  test('accepted a superseded wording still needs asking', () => {
    assert.equal(needsAcceptance('2026-01-01'), true)
    assert.equal(needsAcceptance('2026-09-05', '2026-12-01'), true)
  })

  test('an empty string is not an acceptance', () => {
    assert.equal(needsAcceptance(''), true)
  })
})

describe('the document itself', () => {
  test('carries its own key and version, so nothing has to pair them by hand', () => {
    assert.equal(COD_ADVANCE_POLICY.key, COD_ADVANCE_POLICY_KEY)
    assert.equal(COD_ADVANCE_POLICY.version, COD_ADVANCE_POLICY_VERSION)
  })

  /** `:lang(my)` in globals.css is what stops the diacritics colliding. */
  test('declares Burmese, so the line-height rule applies', () => {
    assert.equal(COD_ADVANCE_POLICY.lang, 'my')
  })

  test('all eleven clauses are present and none is empty', () => {
    assert.equal(COD_ADVANCE_POLICY.sections.length, 11)
    for (const s of COD_ADVANCE_POLICY.sections) {
      assert.ok(s.n.trim().length > 0, 'clause number')
      assert.ok(s.heading.trim().length > 0, `heading for ${s.n}`)
      const body =
        (s.paragraphs?.length ?? 0) +
        (s.bullets?.length ?? 0) +
        (s.forbidden?.length ?? 0) +
        (s.footer ? 1 : 0)
      assert.ok(body > 0, `clause ${s.n} has no body`)
    }
  })

  /**
   * The three clauses that actually assign liability. If a future edit drops
   * one, the acceptance on file stops meaning what the office thinks it means.
   */
  test('the liability clauses survive an edit', () => {
    const byNumber = (frag: string) =>
      COD_ADVANCE_POLICY.sections.find((s) => s.n.includes(frag))

    const fraud = byNumber('၆။')
    assert.ok(fraud, 'clause 6 missing')
    // "the shop bears the loss"
    assert.match(fraud.footer ?? '', /တာဝန်ယူဖြေရှင်းရမည်/)

    const settle = byNumber('၈။')
    assert.ok(settle, 'clause 8 missing')
    // "not final revenue for the shop"
    assert.match(settle.paragraphs?.join(' ') ?? '', /အပြီးသတ်ရရှိပြီးသော ရောင်းရငွေမဟုတ်/)

    const rights = byNumber('၁၀။')
    assert.ok(rights, 'clause 10 missing')
    assert.ok((rights.bullets?.length ?? 0) >= 7, 'clause 10 grounds')
  })

  test('clause 5 keeps its prohibited-contents list', () => {
    const goods = COD_ADVANCE_POLICY.sections.find((s) => s.n.includes('၅။'))
    assert.ok(goods, 'clause 5 missing')
    assert.equal(goods.forbidden?.length, 6)
    // The rock. Named in clause 5 and again in clause 6.
    assert.ok(goods.forbidden?.some((f) => f.includes('ကျောက်ခဲ')))
  })

  /**
   * Burmese only, under both toggles, by deliberate decision: a machine
   * translation of clause 6 or 8 is a different contract. If an English version
   * is ever added it comes from the office with its own version string, so this
   * guards against one being slipped in as a convenience.
   */
  test('no Latin-script prose has crept into the clause bodies', () => {
    // Product nouns and proper names are expected throughout and are not
    // translated by anyone: the brand, "Shop Owner", "COD Advance Settlement
    // Service Fee". They are stripped first so the check is about SENTENCES.
    const expected =
      /Mingalar Delivery Service|Advance Settlement Service Fee|COD Advance Limit|Online Shop Page \/ Account|Bank \/ Wallet Account|Shop Verification|Order History|Risk Assessment|Product Information|Delivery Fee|Return Rate|Payment History|Customer Complaint|Fraud Risk|Order ID \/ Reference|Trusted Partner|Fake Order|Shop Owner|Shop Page/g

    for (const s of COD_ADVANCE_POLICY.sections) {
      for (const line of [...(s.paragraphs ?? []), ...(s.bullets ?? []), s.footer ?? '']) {
        const stripped = line.replace(expected, '')
        const sentence = (stripped.match(/[A-Za-z][A-Za-z ,'-]{24,}/g) ?? [])[0]
        assert.equal(sentence, undefined, `English prose in ${s.n}: ${sentence}`)
      }
    }
  })
})
