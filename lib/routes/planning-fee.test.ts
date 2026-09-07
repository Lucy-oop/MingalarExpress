import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { planningFeeByRoute, type PrimaryAreaFeeRow } from './planning-fee'

const row = (
  route: string,
  fee: number | null | undefined,
  isPrimary = true,
): PrimaryAreaFeeRow => ({
  route_id: route,
  is_primary: isPrimary,
  service_areas: fee === undefined ? null : { delivery_zones: fee === null ? null : { fee } },
})

describe('planningFeeByRoute', () => {
  test('a route in one band earns that band', () => {
    const m = planningFeeByRoute([row('A', 4000), row('A', 4000)])
    assert.equal(m.get('A'), 4000)
  })

  /**
   * THE DIRECTION OF ERROR, and the reason this function exists rather than an
   * average. A route spanning two bands has no single right number. Understating
   * sends a profitable run out carrying a warning, which a dispatcher can
   * override; overstating sends an unprofitable one out carrying none, which
   * nobody catches until settlement.
   */
  test('a route spanning two bands is costed at the lower one', () => {
    const m = planningFeeByRoute([row('C', 5000), row('C', 4000), row('C', 5000)])
    assert.equal(m.get('C'), 4000, 'the pessimistic figure must win')
  })

  test('and order does not change that', () => {
    assert.equal(planningFeeByRoute([row('C', 4000), row('C', 5000)]).get('C'), 4000)
    assert.equal(planningFeeByRoute([row('C', 5000), row('C', 4000)]).get('C'), 4000)
  })

  /**
   * Only the primary mapping bills. `route_areas` is many-to-many, so a
   * township can sit on several routes; the primary one is where its parcels
   * ride and therefore whose run they count toward.
   */
  test('a non-primary mapping does not price a route', () => {
    const m = planningFeeByRoute([row('A', 4000), row('A', 2000, false)])
    assert.equal(m.get('A'), 4000)
  })

  test('a route with only non-primary mappings gets no figure at all', () => {
    const m = planningFeeByRoute([row('B', 4000, false)])
    assert.equal(m.has('B'), false, 'the caller must fall back, not read a zero')
  })

  /**
   * A missing zone must NOT read as free. Zero is a legitimate fee — a
   * promotional zone — so coercing an absent one to it would report a real
   * route as earning nothing and light up the loss warning on every run.
   */
  test('a missing zone is skipped, not treated as free', () => {
    assert.equal(planningFeeByRoute([row('A', 4000), row('A', null)]).get('A'), 4000)
    assert.equal(planningFeeByRoute([row('A', 4000), row('A', undefined)]).get('A'), 4000)
    assert.equal(planningFeeByRoute([row('A', null)]).has('A'), false)
  })

  /** But a real zero is honoured, because a free zone is a real decision. */
  test('a genuine zero fee is kept', () => {
    assert.equal(planningFeeByRoute([row('A', 4000), row('A', 0)]).get('A'), 0)
  })

  test('routes are kept apart', () => {
    const m = planningFeeByRoute([row('A', 4000), row('B', 5000)])
    assert.equal(m.get('A'), 4000)
    assert.equal(m.get('B'), 5000)
  })

  test('no rows is an empty map, not a throw', () => {
    assert.equal(planningFeeByRoute([]).size, 0)
  })
})
