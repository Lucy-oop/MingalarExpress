import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { DICTIONARY, LOCALES, isLocale, localeNumber, t, translator } from './index'

const KEYS = Object.keys(DICTIONARY) as Array<keyof typeof DICTIONARY>

describe('the dictionary', () => {
  test('has both languages on every key, and neither is blank', () => {
    for (const key of KEYS) {
      for (const locale of LOCALES) {
        const value = DICTIONARY[key][locale]
        assert.equal(typeof value, 'string', `${key}.${locale} is not a string`)
        assert.ok(value.trim().length > 0, `${key}.${locale} is blank`)
      }
    }
  })

  /**
   * THE ONE THAT BREAKS SILENTLY. A `{n}` dropped from one side of a pair
   * renders as a sentence with a number missing — "to deliver" instead of
   * "3 to deliver" — and nothing errors.
   */
  test('placeholders match between the two languages', () => {
    const holders = (s: string) => (s.match(/\{[a-z]+\}/gi) ?? []).sort()
    for (const key of KEYS) {
      assert.deepEqual(
        holders(DICTIONARY[key].en),
        holders(DICTIONARY[key].my),
        `${key}: placeholders differ between en and my`,
      )
    }
  })

  /**
   * `as const` makes the two literal unions disjoint for the current
   * dictionary, so tsc rejects `en === my` outright — a stronger guarantee than
   * this test. The widening to `string` is what keeps the check meaningful the
   * day somebody adds a pair that IS identical: then the types overlap, tsc
   * falls silent, and this is the only thing left watching.
   */
  test('nothing was left untranslated by copy-paste', () => {
    // Brand names only. KBZPay is written the same way on the app icon a Yangon
    // customer is holding, so translating it would make it harder to recognise,
    // not easier.
    const allowed = new Set<string>(['pay.kpay'])
    for (const key of KEYS) {
      const en: string = DICTIONARY[key].en
      const my: string = DICTIONARY[key].my
      if (en === my && !allowed.has(key)) {
        assert.fail(`${key} is identical in both languages — was it translated?`)
      }
    }
  })

  test('Burmese strings stay short enough for a thumb-sized button', () => {
    // Not a hard rule for prose, but an action label that wraps on a 5-inch
    // screen is a button a rider misses in the rain.
    for (const key of KEYS) {
      if (!key.startsWith('action.')) continue
      assert.ok(
        DICTIONARY[key].my.length <= 24,
        `${key} is ${DICTIONARY[key].my.length} characters — too long for a button`,
      )
    }
  })
})

describe('t', () => {
  test('returns the requested language', () => {
    assert.equal(t('en', 'nav.jobs'), 'Jobs')
    assert.equal(t('my', 'nav.jobs'), DICTIONARY['nav.jobs'].my)
  })

  test('substitutes every occurrence of a placeholder', () => {
    assert.equal(t('en', 'run.toDeliver', { n: 4 }), '4 to deliver')
    assert.match(t('my', 'run.toDeliver', { n: 4 }), /4/)
  })

  test('an unknown key renders the key, not an empty box', () => {
    // @ts-expect-error deliberately off-dictionary
    assert.equal(t('en', 'no.such.key'), 'no.such.key')
  })

  test('a missing placeholder leaves the token rather than printing "undefined"', () => {
    assert.equal(t('en', 'run.toDeliver'), '{n} to deliver')
  })

  test('translator binds one locale', () => {
    const tr = translator('my')
    assert.equal(tr('nav.jobs'), DICTIONARY['nav.jobs'].my)
  })
})

describe('isLocale', () => {
  test('accepts the two we support and nothing else', () => {
    assert.ok(isLocale('my'))
    assert.ok(isLocale('en'))
    for (const bad of ['th', '', 'MY', null, undefined, 7]) {
      assert.equal(isLocale(bad), false)
    }
  })
})

describe('localeNumber', () => {
  test('Burmese digits for counts', () => {
    assert.equal(localeNumber('my', 0), '၀')
    assert.equal(localeNumber('my', 12), '၁၂')
    assert.equal(localeNumber('en', 12), '12')
  })
})
