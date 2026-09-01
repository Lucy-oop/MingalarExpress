import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ATTEMPTS, backoffMs, classifyFailure } from './offline-queue'

describe('classifyFailure', () => {
  /**
   * Left-hand strings are the real RAISE conditions from migration 0002. The
   * offer conditions ('offer_already_answered', 'offer_expired',
   * 'offer_not_found') were removed in 0009 with the engine that raised them —
   * a queued action is now always a checkpoint on work the rider already holds.
   *
   * The classification is what stops a rider from staring at a permanent error
   * badge for work they actually completed.
   */
  test('a superseded pickup is dropped, not retried forever', () => {
    // Delivered succeeded online; the queued picked_up arrives late.
    assert.equal(classifyFailure('illegal_transition: delivered -> picked_up', 0), 'superseded')
  })

  test('a vanished order is superseded', () => {
    assert.equal(classifyFailure('order_not_found', 0), 'superseded')
  })

  test('losing the race is dead — never retried', () => {
    // Retrying would try to put a second rider on one parcel.
    assert.equal(classifyFailure('order_not_assignable: assigned', 0), 'dead')
  })

  /**
   * A retired condition must NOT be silently classified. These strings no longer
   * come from anywhere, so if one ever reappears it means something unexpected
   * is talking to the rider app, and the honest answer is to retry-then-die on
   * the attempt ceiling rather than to pretend it is a known outcome.
   */
  test('retired offer conditions are not special-cased any more', () => {
    assert.equal(classifyFailure('offer_expired', 0), 'retry')
    assert.equal(classifyFailure('offer_not_found', 0), 'retry')
  })

  test('a permission failure is dead, not a network blip', () => {
    assert.equal(classifyFailure('forbidden', 0), 'dead')
    assert.equal(classifyFailure('permission denied for table orders', 0), 'dead')
  })

  test('proof_required is dead — replaying cannot conjure a photo', () => {
    assert.equal(classifyFailure('proof_required', 0), 'dead')
  })

  test('a network failure retries', () => {
    assert.equal(classifyFailure('Failed to fetch', 0), 'retry')
    assert.equal(classifyFailure('NetworkError when attempting to fetch resource', 3), 'retry')
    assert.equal(classifyFailure('load failed', 1), 'retry')
  })

  test('retrying gives up at the attempt ceiling', () => {
    assert.equal(classifyFailure('Failed to fetch', MAX_ATTEMPTS - 2), 'retry')
    assert.equal(classifyFailure('Failed to fetch', MAX_ATTEMPTS - 1), 'dead')
  })

  test('classification is case-insensitive', () => {
    assert.equal(classifyFailure('ILLEGAL_TRANSITION: x -> y', 0), 'superseded')
    assert.equal(classifyFailure('Forbidden', 0), 'dead')
  })
})

describe('backoffMs', () => {
  test('starts at one second and doubles', () => {
    assert.equal(backoffMs(0), 1_000)
    assert.equal(backoffMs(1), 2_000)
    assert.equal(backoffMs(2), 4_000)
  })

  test('is capped so a rider back in signal is not left waiting minutes', () => {
    assert.equal(backoffMs(10), 30_000)
    assert.equal(backoffMs(100), 30_000)
  })

  test('is monotonic', () => {
    for (let i = 1; i < 12; i++) assert.ok(backoffMs(i) >= backoffMs(i - 1))
  })
})
