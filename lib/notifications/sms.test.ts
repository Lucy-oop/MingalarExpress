import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { smsEncoding, smsLength, smsSegments } from './sms'

/**
 * The arithmetic the cost ceiling in `messages.test.ts` rests on. If this is
 * wrong, that ceiling is decorative.
 */
describe('smsEncoding', () => {
  test('plain English is GSM-7', () => {
    assert.equal(smsEncoding('Mingalar Express: MGE-260901-000009 failed.'), 'gsm7')
  })

  test('a single Burmese character forces the whole message to UCS-2', () => {
    assert.equal(smsEncoding('Order ပ failed'), 'ucs2')
  })

  test('the GSM-7 extension characters do not force UCS-2', () => {
    assert.equal(smsEncoding('cost {40} or [50]'), 'gsm7')
  })

  test('an empty body is GSM-7, not a crash', () => {
    assert.equal(smsEncoding(''), 'gsm7')
  })
})

describe('smsLength', () => {
  test('extension characters cost two septets each', () => {
    // '{' and '}' are sent as ESC + char.
    assert.equal(smsLength('ab'), 2)
    assert.equal(smsLength('a{b}'), 6)
  })

  test('UCS-2 counts UTF-16 code units', () => {
    assert.equal(smsLength('ပါ'), 2)
  })
})

describe('smsSegments', () => {
  test('the GSM-7 boundary is 160, then 153 per part', () => {
    assert.equal(smsSegments('a'.repeat(160)), 1)
    assert.equal(smsSegments('a'.repeat(161)), 2)
    assert.equal(smsSegments('a'.repeat(306)), 2)
    assert.equal(smsSegments('a'.repeat(307)), 3)
  })

  /**
   * THE ONE THAT COSTS MONEY. Burmese fits 70 characters, not 160 — a template
   * that reads as short in English is three segments in Burmese.
   */
  test('the UCS-2 boundary is 70, then 67 per part', () => {
    assert.equal(smsSegments('ပ'.repeat(70)), 1)
    assert.equal(smsSegments('ပ'.repeat(71)), 2)
    assert.equal(smsSegments('ပ'.repeat(134)), 2)
    assert.equal(smsSegments('ပ'.repeat(135)), 3)
  })

  test('nothing to send is nothing to bill', () => {
    assert.equal(smsSegments(''), 0)
  })
})
