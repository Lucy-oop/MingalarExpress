import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PAYOUT_METHODS, payoutProblem } from './payout'

const ok = { amount: 20000, available: 27500, method: 'kbzpay', reference: 'KBZ-1', isDirect: false, recipient: '' }

describe('payoutProblem — mirrors record_shop_payout', () => {
  test('a valid payout has no problem', () => {
    assert.equal(payoutProblem(ok), null)
  })
  test('never more than is available', () => {
    assert.equal(payoutProblem({ ...ok, amount: 27501 }), 'over_available')
    assert.equal(payoutProblem({ ...ok, amount: 27500 }), null)
  })
  test('a whole positive amount only', () => {
    assert.equal(payoutProblem({ ...ok, amount: 0 }), 'amount')
    assert.equal(payoutProblem({ ...ok, amount: 12.5 }), 'amount')
  })
  test('a digital transfer needs a reference; cash at the desk does not', () => {
    assert.equal(payoutProblem({ ...ok, reference: '  ' }), 'reference')
    assert.equal(payoutProblem({ ...ok, method: 'cash', reference: '' }), null)
  })
  test('an unknown channel is refused', () => {
    assert.equal(payoutProblem({ ...ok, method: 'bitcoin' }), 'method')
  })
  test('the Direct shop must name who was paid', () => {
    assert.equal(payoutProblem({ ...ok, isDirect: true }), 'recipient')
    assert.equal(payoutProblem({ ...ok, isDirect: true, recipient: 'Ma Hla, 09 7xx' }), null)
  })
})

describe('the channel list matches the database', () => {
  test('shop_ledger_method_known lists exactly PAYOUT_METHODS', () => {
    const sql = readFileSync(
      new URL('../../supabase/migrations/20261002100000_shop_payouts.sql', import.meta.url),
      'utf8',
    )
    const m = /shop_ledger_method_known\s+check \(method is null or method in \(([^)]*)\)\)/.exec(sql)
    assert.ok(m, 'constraint not found')
    const values = [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1])
    assert.deepEqual(values, [...PAYOUT_METHODS])
  })
})
