import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { splitSettlement } from './settlement-split'

describe('splitSettlement — earnings and cash, never netted', () => {
  test('every run deposited: cash outstanding is 0, earnings stand alone', () => {
    const s = splitSettlement([
      { kind: 'cod_collected', amount: 50000 },
      { kind: 'cod_remitted', amount: -50000 },
      { kind: 'trip_pay', amount: -6000 },
      { kind: 'commission_earned', amount: -2800 },
      { kind: 'pickup_pay', amount: -500 },
    ])
    assert.equal(s.cashCollected, 50000)
    assert.equal(s.cashDeposited, 50000)
    assert.equal(s.cashOutstanding, 0)
    assert.equal(s.earnings, 9300)
    assert.equal(s.earningsToPay, 9300)
  })

  test('cash not handed in is flagged as outstanding, not taken off the pay', () => {
    const s = splitSettlement([
      { kind: 'cod_collected', amount: 20000 },
      { kind: 'trip_pay', amount: -4000 },
    ])
    assert.equal(s.cashOutstanding, 20000)
    assert.equal(s.earningsToPay, 4000)
  })

  test('an adjustment against the rider comes off the pay', () => {
    const s = splitSettlement([
      { kind: 'trip_pay', amount: -6000 },
      { kind: 'adjustment', amount: 1500 },
    ])
    assert.equal(s.deductions, 1500)
    assert.equal(s.earningsToPay, 4500)
  })

  test('the split adds back up to the ledger net', () => {
    const lines = [
      { kind: 'cod_collected', amount: 30000 },
      { kind: 'cod_remitted', amount: -25000 },
      { kind: 'trip_pay', amount: -5000 },
      { kind: 'adjustment', amount: -700 },
    ]
    const s = splitSettlement(lines)
    const net = lines.reduce((sum, l) => sum + l.amount, 0)
    assert.equal(s.cashOutstanding - s.earningsToPay, net)
  })
})

/**
 * No screen shows the blended net any more (0053). `open_balance` survives in
 * cod_positions because settlement nets to it, but every view reads
 * cash_in_hand and unsettled_earnings instead.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('no screen renders the blended balance', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (full.endsWith('.tsx')) files.push(full)
    }
  }
  walk(join(root, 'components'))
  walk(join(root, 'app'))

  test('open_balance appears in no component or page', () => {
    const offenders = files.filter((f) =>
      /\bopen_balance\b/.test(
        readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
      ),
    )
    assert.deepEqual(offenders, [])
  })
})
