import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ADJUSTMENT_CATEGORIES,
  PAYSLIP_METHODS,
  monthHasEnded,
  monthLabel,
  monthOf,
  parseMonth,
  payslipNet,
  shiftMonth,
  variablePay,
} from './payroll'

describe('pay months', () => {
  test('parse to the first of the month, or null', () => {
    assert.equal(parseMonth('2026-09'), '2026-09-01')
    assert.equal(parseMonth('2026-09-17'), '2026-09-01')
    assert.equal(parseMonth('2026-13'), null)
    assert.equal(parseMonth('September'), null)
    assert.equal(parseMonth(undefined), null)
  })
  test('shift across year ends', () => {
    assert.equal(shiftMonth('2026-12-01', 1), '2027-01-01')
    assert.equal(shiftMonth('2026-01-01', -1), '2025-12-01')
  })
  test('a month has ended only from the 1st of the next', () => {
    assert.equal(monthHasEnded('2026-09-01', '2026-09-30'), false)
    assert.equal(monthHasEnded('2026-09-01', '2026-10-01'), true)
  })
  test('labels and month-of', () => {
    assert.equal(monthLabel('2026-09-01'), 'September 2026')
    assert.equal(monthOf('2026-09-27'), '2026-09-01')
  })
})

describe('payslip arithmetic', () => {
  const p = { base_paid: 300000, trip_pay: 15300, parcel_pay: 0, pickup_pay: 0, bonuses: 2000, deductions: 5000 }
  test('base + variable + bonuses - deductions', () => {
    assert.equal(variablePay(p), 15300)
    assert.equal(payslipNet(p), 312300)
  })
})

describe('the lists match the database', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20261003100000_rider_payroll.sql', import.meta.url),
    'utf8',
  )
  const listIn = (re: RegExp) => [...(re.exec(sql)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  test('categories = cod_ledger_category_known', () => {
    assert.deepEqual(listIn(/cod_ledger_category_known\s+check \(category is null or category in \(([^)]*)\)\)/), [
      ...ADJUSTMENT_CATEGORIES,
    ])
  })
  test('methods = payslips_method_known', () => {
    assert.deepEqual(listIn(/payslips_method_known\s+check \(method is null or method in \(([^)]*)\)\)/), [
      ...PAYSLIP_METHODS,
    ])
  })
  test('the net constraint is the same sum as payslipNet', () => {
    assert.match(sql, /net = base_paid \+ trip_pay \+ parcel_pay \+ pickup_pay \+ bonuses - deductions/)
  })
})
