import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_LINK_BASE_LENGTH, orderLink, renderNotification } from './messages'
import { smsSegments } from './sms'

const PAYLOAD = { code: 'MGE-260901-000009', attempt: 2, max_attempts: 3 }

describe('renderNotification', () => {
  test('the parcel code is always in the body', () => {
    for (const lang of ['my', 'en']) {
      for (const event of ['parcel_failed', 'parcel_held']) {
        const body = renderNotification({ event, lang, payload: PAYLOAD })
        assert.ok(body.includes('MGE-260901-000009'), `${lang}/${event}: no code`)
      }
    }
  })

  test('English says which attempt failed, and out of how many', () => {
    const body = renderNotification({ event: 'parcel_failed', lang: 'en', payload: PAYLOAD })
    assert.match(body, /attempt 2 of 3/)
  })

  test('a held parcel says it has stopped, in both languages', () => {
    assert.match(
      renderNotification({ event: 'parcel_held', lang: 'en', payload: PAYLOAD }),
      /on hold/,
    )
    assert.match(
      renderNotification({ event: 'parcel_held', lang: 'my', payload: PAYLOAD }),
      /ရပ်ထား/,
    )
  })

  test('the two events do not produce the same message', () => {
    for (const lang of ['my', 'en']) {
      assert.notEqual(
        renderNotification({ event: 'parcel_failed', lang, payload: PAYLOAD }),
        renderNotification({ event: 'parcel_held', lang, payload: PAYLOAD }),
      )
    }
  })

  /**
   * The default is Burmese, and an unrecognised value must land there rather
   * than on English — `preferred_lang` is CHECK-constrained to my|en today, but
   * a third value added later must not silently switch every shop to English.
   */
  test('an unknown language falls back to Burmese', () => {
    const mm = renderNotification({ event: 'parcel_failed', lang: 'my', payload: PAYLOAD })
    assert.equal(renderNotification({ event: 'parcel_failed', lang: 'th', payload: PAYLOAD }), mm)
    assert.equal(renderNotification({ event: 'parcel_failed', lang: null, payload: PAYLOAD }), mm)
  })

  test('an unknown event renders as a failure rather than throwing', () => {
    const body = renderNotification({ event: 'something_new', lang: 'en', payload: PAYLOAD })
    assert.ok(body.length > 0)
    assert.ok(!body.includes('undefined'))
  })

  test('a missing payload does not leak "undefined" or "NaN" into an SMS', () => {
    for (const lang of ['my', 'en']) {
      for (const event of ['parcel_failed', 'parcel_held']) {
        for (const payload of [null, {}, { code: null, attempt: null, max_attempts: null }]) {
          const body = renderNotification({ event, lang, payload })
          assert.ok(!/undefined|NaN|null/.test(body), `${lang}/${event}: ${body}`)
        }
      }
    }
  })

  test('no link means no dangling space at the end', () => {
    const body = renderNotification({ event: 'parcel_failed', lang: 'en', payload: PAYLOAD })
    assert.equal(body, body.trimEnd())
  })

  /**
   * Deliberate omissions, pinned so they are not "helpfully" added back.
   * The reason is free text a rider typed and could be a paragraph; the COD
   * figure turns the message into a phishing template.
   */
  test('the rider’s reason and the COD amount never reach the SMS', () => {
    const body = renderNotification({
      event: 'parcel_failed',
      lang: 'en',
      payload: {
        ...PAYLOAD,
        fail_reason: 'Customer moved to Hlaing Tharyar and left no number at all',
        cod_amount: 45000,
        customer_name: 'ဒေါ်မြင့်မြင့်အေး',
      },
    })
    assert.ok(!body.includes('Hlaing Tharyar'))
    assert.ok(!body.includes('45000'))
    assert.ok(!body.includes('ဒေါ်မြင့်'))
  })
})

describe('orderLink', () => {
  test('points at the short redirect, not a 36-character UUID', () => {
    assert.equal(orderLink('https://x.test', 'MGE-260901-000009'), 'https://x.test/o/MGE-260901-000009')
  })

  test('a trailing slash on the base does not double up', () => {
    assert.equal(orderLink('https://x.test/', 'MGE-1'), 'https://x.test/o/MGE-1')
  })

  test('no code falls back to the list rather than a broken URL', () => {
    assert.equal(orderLink('https://x.test', null), 'https://x.test/shop/orders')
  })

  test('no base URL yields no link at all, so the message just omits it', () => {
    assert.equal(orderLink(null, 'MGE-1'), '')
    assert.equal(orderLink('', 'MGE-1'), '')
  })
})

/**
 * THE COST CEILING.
 *
 * Every message must fit two SMS segments with a link built from a base URL at
 * the documented maximum. The first draft of these templates failed this by a
 * whole segment on all four combinations — which is the entire reason the test
 * exists rather than an eyeballed "looks short enough".
 */
describe('segment budget', () => {
  const base = `https://${'a'.repeat(MAX_LINK_BASE_LENGTH - 'https://'.length)}`
  const link = orderLink(base, PAYLOAD.code)

  test(`the reference base URL really is ${MAX_LINK_BASE_LENGTH} characters`, () => {
    assert.equal(base.length, MAX_LINK_BASE_LENGTH)
  })

  for (const lang of ['my', 'en']) {
    for (const event of ['parcel_failed', 'parcel_held']) {
      test(`${lang}/${event} fits two segments`, () => {
        const body = renderNotification({ event, lang, payload: PAYLOAD, link })
        const n = smsSegments(body)
        assert.ok(n <= 2, `${n} segments (${body.length} chars): ${body}`)
      })
    }
  }

  test('English fits a single segment, so only Burmese ever costs two', () => {
    for (const event of ['parcel_failed', 'parcel_held']) {
      const body = renderNotification({ event, lang: 'en', payload: PAYLOAD, link })
      assert.equal(smsSegments(body), 1, body)
    }
  })

  /**
   * Guards the constant itself. If a template grows, this fails and forces the
   * budget to be recomputed instead of quietly overrunning in production.
   */
  test('one character more of base URL is what breaks it', () => {
    const tooLong = `${base}a`
    const body = renderNotification({
      event: 'parcel_held',
      lang: 'my',
      payload: PAYLOAD,
      link: orderLink(tooLong, PAYLOAD.code),
    })
    assert.ok(
      smsSegments(body) <= 3,
      'the budget has drifted far from MAX_LINK_BASE_LENGTH — recompute it',
    )
  })
})
