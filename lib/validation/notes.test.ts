import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { orderNoteSchema } from './schemas'

const ORDER = 'aaaaaaaa-0000-0000-0000-000000000001'

describe('orderNoteSchema', () => {
  test('a plain note needs only a body', () => {
    const r = orderNoteSchema.safeParse({ orderId: ORDER, body: 'Rider says the gate was locked' })
    assert.ok(r.success)
    assert.equal(r.data.kind, 'note')
    assert.equal(r.data.body, 'Rider says the gate was locked')
  })

  test('an empty body is refused, and so is whitespace', () => {
    for (const body of ['', '   ', '\n\t']) {
      assert.equal(orderNoteSchema.safeParse({ orderId: ORDER, body }).success, false)
    }
  })

  test('the body is trimmed, so a stray newline is not stored as content', () => {
    const r = orderNoteSchema.safeParse({ orderId: ORDER, body: '  called the shop \n' })
    assert.ok(r.success)
    assert.equal(r.data.body, 'called the shop')
  })

  test('2000 characters pass, 2001 do not — the same ceiling as the CHECK', () => {
    assert.ok(orderNoteSchema.safeParse({ orderId: ORDER, body: 'a'.repeat(2000) }).success)
    assert.equal(orderNoteSchema.safeParse({ orderId: ORDER, body: 'a'.repeat(2001) }).success, false)
  })

  test('a contact keeps who was reached and how', () => {
    const r = orderNoteSchema.safeParse({
      orderId: ORDER,
      kind: 'contact',
      party: 'shop',
      channel: 'viber',
      body: 'U Aung will collect it Thursday',
    })
    assert.ok(r.success)
    assert.equal(r.data.party, 'shop')
    assert.equal(r.data.channel, 'viber')
  })

  /**
   * THE ONE THAT MATTERS. `order_notes_contact_shape` refuses a party or channel
   * on anything but a contact, and a raw 23514 reaches a dispatcher as an
   * unexplainable failure. Normalising beats validating here: the selects are
   * simply irrelevant once the kind is `note`.
   */
  test('a plain note drops any party and channel rather than failing on them', () => {
    const r = orderNoteSchema.safeParse({
      orderId: ORDER,
      kind: 'note',
      party: 'shop',
      channel: 'viber',
      body: 'Left a voicemail',
    })
    assert.ok(r.success)
    assert.equal(r.data.party, null)
    assert.equal(r.data.channel, null)
  })

  test('a contact with nobody named is still a contact, with nulls', () => {
    const r = orderNoteSchema.safeParse({
      orderId: ORDER, kind: 'contact', party: '', channel: '', body: 'Tried, no answer',
    })
    assert.ok(r.success)
    assert.equal(r.data.party, null)
    assert.equal(r.data.channel, null)
  })

  /** `decision` rows come from resolve_failed_order. Nobody types one. */
  test('a decision cannot be filed by hand', () => {
    const r = orderNoteSchema.safeParse({ orderId: ORDER, kind: 'decision', body: 'Decision: cancel.' })
    assert.equal(r.success, false)
  })

  test('an unknown channel is refused', () => {
    const r = orderNoteSchema.safeParse({
      orderId: ORDER, kind: 'contact', channel: 'carrier_pigeon', body: 'hm',
    })
    assert.equal(r.success, false)
  })

  test('a malformed order id is refused', () => {
    assert.equal(orderNoteSchema.safeParse({ orderId: 'nope', body: 'x' }).success, false)
  })
})
