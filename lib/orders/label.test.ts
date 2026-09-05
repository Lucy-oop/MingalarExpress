import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatWeight,
  labelAreaName,
  labelMoney,
  MAX_LABELS,
  parseLabelIds,
  type LabelMoneyInput,
} from './label'

/** A customer-pays COD parcel: 45,000 of goods on a 3,500 route. */
const COD: LabelMoneyInput = {
  payment_method: 'cod',
  cod_amount: 48_500,
  delivery_fee: 3_500,
  fee_payer: 'customer',
}

describe('labelMoney — the figure that reaches the doorstep', () => {
  /**
   * THE REGRESSION THIS FILE EXISTS FOR. `cod_amount` already contains the
   * delivery fee when the customer pays it. Printing cod_amount + delivery_fee
   * would ask this customer for 52,000 instead of 48,500 -- the fee charged
   * twice, in ink, with no constraint downstream able to notice.
   */
  test('a customer-pays parcel collects cod_amount, NOT cod_amount + fee', () => {
    const m = labelMoney(COD)
    assert.equal(m.collect, true)
    assert.equal(m.collect && m.amount, 48_500)
    assert.notEqual(m.collect && m.amount, COD.cod_amount + COD.delivery_fee)
    assert.equal(m.collect && m.text, '48,500 Ks')
    assert.equal(m.collect && m.feeNote, 'included')
  })

  test('a shop-pays parcel collects the same stored figure, worded differently', () => {
    // The shop bearing the fee means cod_amount is goods only -- but it is
    // still the whole of what the rider takes. Same field, same rule.
    const m = labelMoney({ ...COD, cod_amount: 45_000, fee_payer: 'shop' })
    assert.equal(m.collect && m.amount, 45_000)
    assert.equal(m.collect && m.feeNote, 'shop_pays')
  })

  test('a prepaid parcel prints no figure at all', () => {
    assert.deepEqual(labelMoney({ ...COD, payment_method: 'prepaid', cod_amount: 0 }), {
      collect: false,
    })
  })

  /**
   * `orders_cod_consistent` makes this unreachable through the app, but a label
   * is printed from whatever the row says. A zero in a COD box would read as
   * "collect nothing" to a rider either way, so say it in words.
   */
  test('a COD row with a zero amount is treated as nothing to collect', () => {
    assert.deepEqual(labelMoney({ ...COD, cod_amount: 0 }), { collect: false })
  })
})

describe('parseLabelIds — untrusted query string', () => {
  const A = 'aaaaaaaa-0000-0000-0000-000000000001'
  const B = 'bbbbbbbb-0000-0000-0000-000000000002'

  test('a single id', () => {
    assert.deepEqual(parseLabelIds(A), [A])
  })

  test('a comma-separated batch, whitespace and all', () => {
    assert.deepEqual(parseLabelIds(` ${A} , ${B} `), [A, B])
  })

  test('missing is empty, not an error', () => {
    assert.deepEqual(parseLabelIds(undefined), [])
    assert.deepEqual(parseLabelIds(''), [])
  })

  /**
   * A malformed uuid reaching PostgREST is a 400 that takes the whole page
   * down. Dropping it costs nothing: RLS already means some ids legitimately
   * produce no label, so the page handles a short result regardless.
   */
  test('anything not uuid-shaped is dropped, and does not poison the rest', () => {
    assert.deepEqual(parseLabelIds(`${A},not-a-uuid,'; drop table orders--,${B}`), [A, B])
    assert.deepEqual(parseLabelIds('1,2,3'), [])
  })

  /** The seed's ids are valid Postgres uuids and invalid RFC 9562 ones. */
  test('a seed-style id is accepted, version nibbles notwithstanding', () => {
    assert.deepEqual(parseLabelIds('aaaaaaaa-0000-0000-0000-000000000001'), [A])
  })

  test('duplicates collapse, so one parcel prints one label', () => {
    assert.deepEqual(parseLabelIds(`${A},${A},${A.toUpperCase()}`), [A])
  })

  test('capped, so a hand-typed URL cannot ask for a mile of roll', () => {
    const many = Array.from(
      { length: MAX_LABELS + 25 },
      (_, i) => `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
    )
    assert.equal(parseLabelIds(many.join(',')).length, MAX_LABELS)
  })

  test('repeated ?ids= params are treated as one list', () => {
    assert.deepEqual(parseLabelIds([A, B]), [A, B])
  })
})

describe('formatWeight', () => {
  test('grams below a kilo', () => {
    assert.equal(formatWeight(900), '900 g')
    assert.equal(formatWeight(1), '1 g')
  })

  test('a kilo and over, to one decimal', () => {
    assert.equal(formatWeight(1200), '1.2 kg')
    assert.equal(formatWeight(1000), '1 kg')
    assert.equal(formatWeight(2050), '2.1 kg')
  })

  /** The column is nullable and optional in the form; most parcels have none. */
  test('absent or zero prints nothing rather than an em-dash', () => {
    assert.equal(formatWeight(null), null)
    assert.equal(formatWeight(undefined), null)
    assert.equal(formatWeight(0), null)
  })
})

describe('labelAreaName — both scripts, never the cookie', () => {
  test('Burmese leads, English follows', () => {
    assert.equal(labelAreaName({ name: 'Bahan', name_mm: 'ဗဟန်း' }), 'ဗဟန်း · Bahan')
  })

  test('no Burmese name is just the English one, not a dangling separator', () => {
    assert.equal(labelAreaName({ name: 'Bahan', name_mm: null }), 'Bahan')
    assert.equal(labelAreaName({ name: 'Bahan', name_mm: '  ' }), 'Bahan')
  })

  test('identical names are not printed twice', () => {
    assert.equal(labelAreaName({ name: 'Bahan', name_mm: 'Bahan' }), 'Bahan')
  })

  /** dropoff_area_id is nullable -- an older parcel may have none. */
  test('no area at all', () => {
    assert.equal(labelAreaName(null), null)
    assert.equal(labelAreaName(undefined), null)
    assert.equal(labelAreaName({ name: '', name_mm: null }), null)
  })
})
