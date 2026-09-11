import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { formatMmk } from './utils'

describe('formatMmk', () => {
  test('formats a plain amount', () => {
    assert.equal(formatMmk(2800), '2,800 Ks')
    assert.equal(formatMmk(0), '0 Ks')
  })

  test('keeps a real negative negative', () => {
    assert.equal(formatMmk(-2800), '-2,800 Ks')
  })

  /**
   * THE ONE THAT SHIPPED. JavaScript has a signed zero and Intl renders it
   * faithfully, so `format(-0)` is "-0". Way history reached it the ordinary
   * way: ledger amounts are stored negative, the pay sums flip them back with a
   * leading minus, and negating the sum of an empty list gives -0. A run that
   * earned nothing printed "-0 Ks", which reads as a deduction.
   */
  test('never prints negative zero', () => {
    assert.equal(formatMmk(-0), '0 Ks')
    assert.equal(formatMmk(-[].reduce((n: number, x: number) => n + x, 0)), '0 Ks')
    // The rounding path reaches it too: anything in (-0.5, 0) rounds to -0.
    assert.equal(formatMmk(-0.4), '0 Ks')
  })

  test('passes through null as an em-dash', () => {
    assert.equal(formatMmk(null), '—')
    assert.equal(formatMmk(undefined), '—')
  })
})
