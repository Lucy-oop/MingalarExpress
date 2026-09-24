import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DIRECT_SHOP,
  ORDER_SOURCES,
  OUTSIDE_CHANNELS,
  isOutsideChannel,
  outsidePayment,
  parseFeeOverride,
} from './outside-way'

describe('outsidePayment — the three answers, as the shop form stores them', () => {
  test('nothing paid: collect goods plus the fee when the receiver pays it', () => {
    assert.deepEqual(outsidePayment('nothing', '45,000', 'customer', 4000), {
      ok: true,
      paymentMethod: 'cod',
      goodsValue: 45000,
      feePayer: 'customer',
      collect: 49000,
    })
  })

  test('nothing paid, shop pays the fee: collect the goods alone', () => {
    const p = outsidePayment('nothing', '45000', 'shop', 4000)
    assert.ok(p.ok)
    assert.equal(p.collect, 45000)
  })

  /** The regression booking.ts exists for: blank must never mean prepaid. */
  test('nothing paid with a blank amount is refused, not booked as prepaid', () => {
    assert.deepEqual(outsidePayment('nothing', '', 'customer', 4000), {
      ok: false,
      reason: 'amount_empty',
    })
    assert.deepEqual(outsidePayment('nothing', '0', 'customer', 4000), {
      ok: false,
      reason: 'amount_empty',
    })
  })

  test('product paid: collect the delivery fee only, whatever was typed', () => {
    const p = outsidePayment('product', '99999', 'shop', 5000)
    assert.ok(p.ok)
    assert.equal(p.paymentMethod, 'cod')
    assert.equal(p.feePayer, 'customer')
    assert.equal(p.collect, 5000)
  })

  test('everything paid: prepaid, nothing collected, the shop is billed', () => {
    const p = outsidePayment('all', '', 'customer', 4000)
    assert.ok(p.ok)
    assert.equal(p.paymentMethod, 'prepaid')
    assert.equal(p.feePayer, 'shop')
    assert.equal(p.collect, 0)
  })

  test('an office fee override flows into the collection', () => {
    const p = outsidePayment('nothing', '10000', 'customer', 2500)
    assert.ok(p.ok)
    assert.equal(p.collect, 12500)
  })
})

describe('parseFeeOverride', () => {
  test('blank means the zone price, not zero', () => {
    assert.deepEqual(parseFeeOverride('  '), { ok: true, value: null })
  })
  test('zero is a free delivery typed on purpose', () => {
    assert.deepEqual(parseFeeOverride('0'), { ok: true, value: 0 })
  })
  test('separators are accepted, decimals refused', () => {
    assert.deepEqual(parseFeeOverride('3,500'), { ok: true, value: 3500 })
    assert.deepEqual(parseFeeOverride('3500.5'), { ok: false, reason: 'decimal' })
  })
})

describe('channels', () => {
  test('outside channels are every source but the portal', () => {
    assert.deepEqual([...OUTSIDE_CHANNELS], ORDER_SOURCES.filter((s) => s !== 'portal'))
    assert.equal(isOutsideChannel('portal'), false)
    assert.equal(isOutsideChannel('viber'), true)
  })

  test('the list matches orders_source_known in migration 0048', () => {
    const sql = readFileSync(
      new URL('../../supabase/migrations/20260924100000_outside_way.sql', import.meta.url),
      'utf8',
    )
    const check = sql.match(/check \(source in \(([^)]*)\)\)/)
    assert.ok(check, 'orders_source_known not found')
    const values = [...check[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1])
    assert.deepEqual(values, [...ORDER_SOURCES])
  })

  test('the Direct picker value can never be a shop id', () => {
    assert.ok(!/^[0-9a-f-]{36}$/i.test(DIRECT_SHOP))
  })
})

/**
 * The Outside Way form shows no way names (the office picks the way on the
 * board, 0049) and says ကြိုရှင်း, never "COD". Source scan: no DOM harness.
 */
describe('the Outside Way form', () => {
  const form = readFileSync(
    new URL('../../components/admin/outside-way-form.tsx', import.meta.url),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  test('offers no way to choose and renders no way name', () => {
    assert.ok(!/wayLabel|routeName|routeCode|routes\.map/.test(form), 'a way name is rendered')
    assert.match(form, /t\('ow\.routeLater'\)/)
  })

  test('its ကြိုရှင်း labels never say COD', async () => {
    const { DICTIONARY } = await import('@/lib/i18n/dictionary')
    for (const [key, entry] of Object.entries(DICTIONARY)) {
      if (!key.startsWith('ow.')) continue
      assert.ok(!/\bCOD\b/.test(entry.en) && !/\bCOD\b/.test(entry.my), `${key} still says COD`)
    }
  })
})
