import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dedupeCustomers,
  matchesTerm,
  phoneDigits,
  reuse,
  type PastOrderRow,
} from './customer-lookup'

const row = (over: Partial<PastOrderRow> = {}): PastOrderRow => ({
  customer_name: 'Daw Myint',
  customer_phone: '+959791234567',
  customer_phone_alt: null,
  dropoff_address: 'No. 7, Baho Street, Lhay Htaung Kan Ward, Thingangyun',
  dropoff_area_id: 'lhay',
  dropoff_lat: 16.8395,
  dropoff_lng: 96.182,
  dropoff_note: 'Blue gate',
  created_at: '2026-09-03T10:00:00Z',
  ...over,
})

describe('phoneDigits — the same customer, however it was typed', () => {
  test('every way a Myanmar mobile gets written reduces to one key', () => {
    const canonical = phoneDigits('+959791234567')
    for (const typed of [
      '+959791234567',
      '959791234567',
      '09791234567',
      '9791234567',
      '09 791 234 567',
      '09-791-234-567',
      '(09) 791234567',
    ]) {
      assert.equal(phoneDigits(typed), canonical, typed)
    }
  })

  test('nothing usable reduces to an empty string, not a match-everything', () => {
    assert.equal(phoneDigits(''), '')
    assert.equal(phoneDigits('abc'), '')
    assert.equal(phoneDigits('0'), '')
  })
})

describe('dedupeCustomers', () => {
  /**
   * Keyed on the phone, not the name: a shop types the same person's name three
   * different ways, and two customers can share one. The phone is what
   * identifies them and what the rider dials.
   */
  test('one entry per phone, however the name was spelled', () => {
    const out = dedupeCustomers([
      row({ customer_name: 'Daw Myint' }),
      row({ customer_name: 'daw myint aye' }),
      row({ customer_name: 'D. Myint' }),
    ])
    assert.equal(out.length, 1)
    assert.equal(out[0]!.orderCount, 3)
  })

  test('the same person typed with and without the country code is one customer', () => {
    const out = dedupeCustomers([row(), row({ customer_phone: '09791234567' })])
    assert.equal(out.length, 1)
    assert.equal(out[0]!.orderCount, 2)
  })

  /** People move. The newest address is the one worth reusing. */
  test('the first row wins, so callers must pass newest-first', () => {
    const out = dedupeCustomers([
      row({ dropoff_address: 'NEW address', created_at: '2026-09-03T10:00:00Z' }),
      row({ dropoff_address: 'old address', created_at: '2026-01-01T10:00:00Z' }),
    ])
    assert.equal(out[0]!.dropoff_address, 'NEW address')
  })

  test('different customers stay separate', () => {
    const out = dedupeCustomers([row(), row({ customer_phone: '+959770000001' })])
    assert.equal(out.length, 2)
  })

  test('a row with no usable phone is dropped rather than keyed on empty', () => {
    const out = dedupeCustomers([row({ customer_phone: '' }), row()])
    assert.equal(out.length, 1)
    assert.equal(out[0]!.customer_phone, '+959791234567')
  })

  test('the limit is honoured, and never truncates to nothing', () => {
    const many = Array.from({ length: 20 }, (_, i) => row({ customer_phone: `+95979123${1000 + i}` }))
    assert.equal(dedupeCustomers(many, 6).length, 6)
    assert.equal(dedupeCustomers(many, 0).length, 1)
  })

  test('no history is an empty list, not a crash', () => {
    assert.deepEqual(dedupeCustomers([]), [])
  })
})

describe('matchesTerm', () => {
  test('a name match is case-insensitive and partial', () => {
    assert.equal(matchesTerm(row(), 'myint'), true)
    assert.equal(matchesTerm(row(), 'DAW'), true)
    assert.equal(matchesTerm(row(), 'Kyaw'), false)
  })

  test('a phone match works from any fragment, however the term is punctuated', () => {
    assert.equal(matchesTerm(row(), '791234'), true)
    assert.equal(matchesTerm(row(), '09 791 234 567'), true)
    assert.equal(matchesTerm(row(), '+959791234567'), true)
    assert.equal(matchesTerm(row(), '770000'), false)
  })

  test('the alternate number is searchable too', () => {
    const c = row({ customer_phone_alt: '+959770000009' })
    assert.equal(matchesTerm(c, '770000'), true)
  })

  /**
   * "09" is a trunk prefix, not a search: reduced to digits it is empty, and
   * treating it as a phone term would match every customer the shop has.
   */
  test('a bare trunk prefix does not match everyone', () => {
    assert.equal(matchesTerm(row(), '09'), false)
  })

  test('an empty term matches everything, so the list shows recents', () => {
    assert.equal(matchesTerm(row(), ''), true)
    assert.equal(matchesTerm(row(), '   '), true)
  })
})

describe('reuse — what the form fills in', () => {
  test('carries the identity, the place AND the point', () => {
    const r = reuse(row())
    assert.equal(r.name, 'Daw Myint')
    assert.equal(r.phone, '+959791234567')
    assert.equal(r.areaId, 'lhay')
    assert.deepEqual(r.point, { lat: 16.8395, lng: 96.182 })
    assert.equal(r.note, 'Blue gate')
  })

  /**
   * The coordinate is still the real prize. 0037 made the dropoff pin optional,
   * so it is no longer guaranteed — but a reused point is somewhere a rider has
   * ACTUALLY BEEN, which beats a geocode guess or a VERIFY-CENTROID township
   * placeholder. Picking a returning customer remains the best case for a pin.
   */
  test('the reused point is a real past delivery', () => {
    const r = reuse(row())
    assert.equal(typeof r.point?.lat, 'number')
    assert.equal(typeof r.point?.lng, 'number')
  })

  /**
   * And a past order booked WITHOUT a pin hands back no point rather than half
   * of one. `{ lat: null }` in the form would reach `orders_dropoff_pin_complete`
   * as a constraint violation instead of a clean absence.
   */
  test('a past order with no pin yields no point', () => {
    const r = reuse(row({ dropoff_lat: null, dropoff_lng: null }))
    assert.equal(r.point, null)
    // Everything else about the customer still comes back.
    assert.equal(r.name, row().customer_name)
    assert.equal(r.address, row().dropoff_address)
  })

  test('nulls become empty strings, never the text "null" in an input', () => {
    const r = reuse(row({ customer_phone_alt: null, dropoff_note: null, dropoff_area_id: null }))
    assert.equal(r.phoneAlt, '')
    assert.equal(r.note, '')
    assert.equal(r.areaId, '')
  })

  /** Money and contents change every time; carrying them over would be wrong. */
  test('nothing about the money or the parcel is carried over', () => {
    const r = reuse(row()) as Record<string, unknown>
    for (const key of ['codAmount', 'goodsValue', 'parcelDesc', 'deliveryFee', 'paymentMethod']) {
      assert.equal(key in r, false, `reuse() leaked ${key}`)
    }
  })
})
