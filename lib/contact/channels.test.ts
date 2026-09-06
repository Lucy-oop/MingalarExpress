import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { OFFICE_HOURS, contactChannels, viberHref } from './channels'

const DB_PHONE = '+959791234567'

describe('contactChannels — the phone comes from two places', () => {
  /**
   * `app_settings.support_phone` is the office's own field and wins. The
   * constant behind it is not a duplicate: it is what keeps the call button
   * working on a deployment where nobody has filled the field in, or where
   * `public_settings()` has not been pushed yet.
   */
  test('the office setting wins when it is set', () => {
    const phone = contactChannels(DB_PHONE).find((c) => c.id === 'phone')
    assert.equal(phone?.href, `tel:${DB_PHONE}`)
  })

  test('and the built-in number covers a blank setting', () => {
    for (const empty of [null, undefined, '', '   ']) {
      const phone = contactChannels(empty).find((c) => c.id === 'phone')
      assert.ok(phone, `no phone row for ${JSON.stringify(empty)}`)
      assert.match(phone.href, /^tel:\+959\d{7,9}$/)
    }
  })

  test('the digits are shown, not hidden behind the word "Phone"', () => {
    const phone = contactChannels(DB_PHONE).find((c) => c.id === 'phone')
    assert.equal(phone?.detail, '09 791 234 567')
  })
})

describe('contactChannels — Viber', () => {
  /**
   * A Viber account in Myanmar IS a phone number, and the office runs two of
   * them. Both are rows, because a rider or a shop should be able to tap either
   * rather than read a comma-separated list and copy one out by hand.
   */
  test('both office numbers get their own row', () => {
    const viber = contactChannels(null).filter((c) => c.id === 'viber')
    assert.equal(viber.length, 2)
    assert.equal(new Set(viber.map((v) => v.key)).size, 2, 'two rows share a React key')
  })

  /** `viber://chat?number=+959…` with a bare `+` is not a valid URL. */
  test('the + is percent-encoded', () => {
    assert.equal(viberHref('+959764148037'), 'viber://chat?number=%2B959764148037')
    for (const v of contactChannels(null).filter((c) => c.id === 'viber')) {
      assert.ok(!v.href.includes('+'), `raw + survived in ${v.href}`)
      assert.match(v.href, /^viber:\/\/chat\?number=%2B959\d{7,9}$/)
    }
  })

  /**
   * The deep link does nothing in a desktop browser and nothing on a phone
   * without Viber installed. The number in `detail` is the fallback that makes
   * the row useful anyway — it can be read aloud or copied.
   */
  test('every Viber row still shows a dialable number', () => {
    for (const v of contactChannels(null).filter((c) => c.id === 'viber')) {
      assert.match(v.detail ?? '', /^09( \d{3})+$/)
    }
  })
})

describe('contactChannels — getting help is not the same as following', () => {
  test('phone, Viber and Telegram are support; Facebook and TikTok are social', () => {
    const kind = (id: string) => contactChannels(null).find((c) => c.id === id)?.kind
    assert.equal(kind('phone'), 'support')
    assert.equal(kind('viber'), 'support')
    assert.equal(kind('telegram'), 'support')
    assert.equal(kind('facebook'), 'social')
    assert.equal(kind('tiktok'), 'social')
  })

  test('support comes before social, so a lost parcel is not below a video', () => {
    const kinds = contactChannels(null).map((c) => c.kind)
    assert.deepEqual(
      [...kinds].sort((a, b) => (a === b ? 0 : a === 'support' ? -1 : 1)),
      kinds,
    )
  })
})

describe('contactChannels — the links themselves', () => {
  test('the web channels are absolute https and marked external', () => {
    for (const c of contactChannels(null).filter((c) => c.external)) {
      assert.match(c.href, /^https:\/\//, `${c.id} is not https`)
    }
    // tel: and viber: hand off to an app on the same device; they are not
    // "external" in the target="_blank" sense and must not be treated as such.
    for (const c of contactChannels(null).filter((c) => !c.external)) {
      assert.match(c.href, /^(tel|viber):/)
    }
  })

  /** A Facebook share URL carries the identity of whoever copied it. */
  test('no tracking parameter rides along on the Facebook link', () => {
    const fb = contactChannels(null).find((c) => c.id === 'facebook')
    assert.ok(fb)
    assert.ok(!fb.href.includes('mibextid'), 'the share link still carries mibextid')
  })

  test('every row has somewhere to go and something to read', () => {
    for (const c of contactChannels(null)) {
      assert.ok(c.href.trim().length > 0, `${c.key} has no href`)
      assert.ok(c.name.trim().length > 0, `${c.key} has no name`)
    }
  })
})

describe('OFFICE_HOURS', () => {
  /**
   * Not a DICTIONARY key on purpose — it is a value the office changes, not UI
   * copy. But it still has to exist in both languages, so it gets the same
   * check dictionary.test.ts applies to everything else.
   */
  test('exists in both languages, and they differ', () => {
    assert.ok(OFFICE_HOURS.en.trim().length > 0)
    assert.ok(OFFICE_HOURS.my.trim().length > 0)
    assert.notEqual(OFFICE_HOURS.en, OFFICE_HOURS.my)
  })

  test('the Burmese hours are in Burmese digits', () => {
    assert.match(OFFICE_HOURS.my, /[၀-၉]/)
    assert.ok(!/[0-9]/.test(OFFICE_HOURS.my), 'an Arabic digit slipped into the Burmese hours')
  })
})
