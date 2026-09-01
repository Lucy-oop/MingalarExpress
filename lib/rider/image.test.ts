import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_EDGE_PX, proofObjectPath, scaledSize } from './image'

describe('scaledSize', () => {
  test('leaves a small image alone', () => {
    assert.deepEqual(scaledSize(800, 600), { width: 800, height: 600 })
  })

  test('scales a landscape phone photo to the long edge', () => {
    assert.deepEqual(scaledSize(4032, 3024), { width: 1280, height: 960 })
  })

  test('scales a portrait photo by its long edge, not its width', () => {
    assert.deepEqual(scaledSize(3024, 4032), { width: 960, height: 1280 })
  })

  test('an image exactly at the limit is untouched', () => {
    assert.deepEqual(scaledSize(1280, 720), { width: 1280, height: 720 })
  })

  test('never produces a zero dimension for an extreme aspect ratio', () => {
    // A 0-width canvas throws, so this guard is load-bearing.
    const { width, height } = scaledSize(20000, 3)
    assert.equal(width, MAX_EDGE_PX)
    assert.ok(height >= 1, `height was ${height}`)
  })

  test('respects a custom max edge', () => {
    assert.deepEqual(scaledSize(2000, 1000, 500), { width: 500, height: 250 })
  })
})

describe('proofObjectPath', () => {
  const ORDER = '3f7b1c2a-0000-4000-8000-000000000001'

  test('puts the order id in the FIRST path segment', () => {
    // The storage policy reads (storage.foldername(name))[1]::uuid as the order
    // id. If this ever changes shape, every proof upload starts failing 42501.
    const path = proofObjectPath(ORDER, 'webp')
    assert.equal(path.split('/')[0], ORDER)
  })

  test('has exactly one folder level', () => {
    assert.equal(proofObjectPath(ORDER, 'webp').split('/').length, 2)
  })

  test('carries the extension', () => {
    assert.match(proofObjectPath(ORDER, 'jpg'), /\.jpg$/)
    assert.match(proofObjectPath(ORDER, 'webp'), /\.webp$/)
  })

  test('is unique across calls', () => {
    const paths = new Set(Array.from({ length: 50 }, () => proofObjectPath(ORDER, 'webp')))
    assert.equal(paths.size, 50)
  })
})
