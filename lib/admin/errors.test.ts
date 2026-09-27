import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { explainAdminError } from './errors'

/**
 * 0055's refusals must reach the operator as themselves. Two of them carry
 * SQLSTATE 42501, so the generic "permission" rule would swallow them if it
 * came first -- and "you do not have permission" to a super admin is a lie
 * that sends them to SQL.
 */
describe('explainAdminError — 0055 refusals', () => {
  test('an open run blocking a settlement says so', () => {
    assert.match(explainAdminError('rider_has_open_run'), /run out or back at the hub/)
  })

  test('the append-only ledger says to book an adjustment, not "no permission"', () => {
    const m = explainAdminError('cod_ledger_append_only (42501)')
    assert.match(m, /never edited or deleted/)
    assert.doesNotMatch(m, /permission/)
  })

  test('an adjustment without a reason names the rule', () => {
    assert.match(
      explainAdminError('new row violates check constraint "cod_ledger_adjustment_reason"'),
      /needs a reason/,
    )
  })
})
