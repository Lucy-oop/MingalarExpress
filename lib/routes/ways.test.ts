import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { closeBlocker, isReceivable, isUncollected, wayLabel } from './ways'

describe('wayLabel', () => {
  test('lettered routes become numbered ways', () => {
    assert.equal(wayLabel('ROUTE_A'), 'Way 1')
    assert.equal(wayLabel('ROUTE_B'), 'Way 2')
    assert.equal(wayLabel('ROUTE_C'), 'Way 3')
    assert.equal(wayLabel('ROUTE_D'), 'Way 4')
  })
  test('the local route is the Local Way', () => {
    assert.equal(wayLabel('ROUTE_LOCAL'), 'Local Way')
  })
  test('anything else is readable, never "ROUTE_"', () => {
    assert.equal(wayLabel('ROUTE_NORTH_EAST'), 'North East')
  })

  /**
   * The rename matches the data migration, so a name and its short label
   * never say two different numbers.
   */
  test('0049 renames by the same letter-to-number rule', () => {
    const sql = readFileSync(
      new URL('../../supabase/migrations/20260925100000_ways_and_partial_receive.sql', import.meta.url),
      'utf8',
    )
    assert.match(sql, /'Way ' \|\| \(ascii\(substr\(code, 7, 1\)\) - 64\)/)
  })
})

describe('isReceivable', () => {
  test('only a collected pickup can be ticked off the bike', () => {
    assert.equal(isReceivable({ leg: 'pickup', status: 'picked_up' }), true)
    assert.equal(isReceivable({ leg: 'pickup', status: 'assigned' }), false)
    assert.equal(isReceivable({ leg: 'pickup', status: 'failed' }), false)
    assert.equal(isReceivable({ leg: 'delivery', status: 'picked_up' }), false)
  })
})

describe('closeBlocker — Close & pay is disabled exactly when close_trip refuses', () => {
  const p = (leg: string, status: string) => ({ leg, status })

  test('a finished run can close', () => {
    assert.equal(closeBlocker([p('delivery', 'delivered'), p('pickup', 'failed'), p('return', 'returned')]), null)
  })

  test('deliveries still out block it', () => {
    assert.deepEqual(closeBlocker([p('delivery', 'picked_up'), p('delivery', 'delivered')]), {
      kind: 'open_deliveries',
      count: 1,
    })
  })

  /** 0051: the hole. An uncollected pickup used to close onto a dead run. */
  test('a pickup the rider never collected blocks it', () => {
    assert.deepEqual(closeBlocker([p('pickup', 'assigned'), p('pickup', 'pending')]), {
      kind: 'uncollected',
      count: 2,
    })
    assert.equal(isUncollected(p('pickup', 'picked_up')), false)
  })

  test('a collected pickup not yet received blocks it (0050)', () => {
    assert.deepEqual(closeBlocker([p('pickup', 'picked_up')]), { kind: 'unreceived', count: 1 })
  })

  test('cancelled parcels never block it', () => {
    assert.equal(closeBlocker([p('delivery', 'cancelled'), p('pickup', 'cancelled')]), null)
  })
})
