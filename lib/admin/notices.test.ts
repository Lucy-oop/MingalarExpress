import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  officeNotices,
  shopRegistrationNotice,
  unseenCount,
  type ShopRegistration,
} from './notices'

const shop = (over: Partial<ShopRegistration> = {}): ShopRegistration => ({
  shopId: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'San Pya Mini Mart',
  ownerName: 'Daw Su Su',
  goodsType: 'Clothes and bags',
  createdAt: '2026-09-08T03:00:00.000Z',
  ...over,
})

describe('shopRegistrationNotice', () => {
  /**
   * The title names the SHOP. "A new shop registered" is true of every row in
   * the feed and therefore tells the office nothing they can act on — the name
   * is what they will scan the list for five minutes later.
   */
  test('the title names the shop', () => {
    assert.match(shopRegistrationNotice(shop()).title, /^San Pya Mini Mart has registered$/)
  })

  /**
   * The link has to be the one `ShopManager` already understands: it reads
   * `?shop=` on mount, opens ShopDetailModal on that row, then replaces the
   * query so a refresh does not reopen it. A different shape silently lands on
   * the list with nothing selected.
   */
  test('the link opens that shop’s details', () => {
    const n = shopRegistrationNotice(shop({ shopId: 'abc-123' }))
    assert.equal(n.href, '/admin/shops?shop=abc-123')
  })

  test('what they sell rides along, because that is the COD decision', () => {
    assert.equal(shopRegistrationNotice(shop()).detail, 'Daw Su Su · Clothes and bags')
  })

  test('and the owner alone when they did not say', () => {
    assert.equal(shopRegistrationNotice(shop({ goodsType: null })).detail, 'Daw Su Su')
  })

  /** Unreachable given `name text not null`, but this renders in a layout. */
  test('a nameless shop still produces a readable line', () => {
    assert.equal(shopRegistrationNotice(shop({ name: null })).title, 'A new shop has registered')
  })

  test('the id is stable, so React keys and any dedupe hold', () => {
    assert.equal(shopRegistrationNotice(shop()).id, shopRegistrationNotice(shop()).id)
    assert.notEqual(
      shopRegistrationNotice(shop({ shopId: 'x' })).id,
      shopRegistrationNotice(shop({ shopId: 'y' })).id,
    )
  })
})

describe('officeNotices', () => {
  test('newest first — a feed is read, not worked', () => {
    const out = officeNotices([
      shop({ shopId: 'old', createdAt: '2026-09-01T00:00:00.000Z' }),
      shop({ shopId: 'new', createdAt: '2026-09-08T00:00:00.000Z' }),
      shop({ shopId: 'mid', createdAt: '2026-09-04T00:00:00.000Z' }),
    ])
    assert.deepEqual(
      out.map((n) => n.id),
      ['shop_registered:new', 'shop_registered:mid', 'shop_registered:old'],
    )
  })

  test('nothing in, nothing out', () => {
    assert.deepEqual(officeNotices([]), [])
  })
})

describe('unseenCount, against the office marker', () => {
  const feed = officeNotices([
    shop({ shopId: 'a', createdAt: '2026-09-08T03:00:00.000Z' }),
    shop({ shopId: 'b', createdAt: '2026-09-07T03:00:00.000Z' }),
    shop({ shopId: 'c', createdAt: '2026-09-06T03:00:00.000Z' }),
  ])

  /**
   * A dispatcher's first shift should show the backlog, not an empty bell —
   * which is why NULL counts as everything rather than nothing.
   */
  test('never looked means everything is new', () => {
    assert.equal(unseenCount(feed, null), 3)
  })

  test('a marker after the newest clears it', () => {
    assert.equal(unseenCount(feed, '2026-09-09T00:00:00.000Z'), 0)
  })

  test('and in between counts only what arrived since', () => {
    assert.equal(unseenCount(feed, '2026-09-07T00:00:00.000Z'), 2)
  })

  /** A corrupt marker should over-report, never hide the feed. */
  test('an unparseable marker counts everything', () => {
    assert.equal(unseenCount(feed, 'not a date'), 3)
  })
})

describe('the regression this feature exists to prevent', () => {
  /**
   * `getNewShopNotices` filters `approved_at is null`, so reviewing a shop
   * removes it from the office WORKLIST — correct, that is a queue being
   * worked. The feed must not behave that way: approving a shop would
   * otherwise erase the only record that it ever registered.
   *
   * Nothing in this module can see `approved_at`, and that is the guarantee.
   * The test pins the shape so a later "helpful" addition of an approval field
   * has to break it on the way in.
   */
  test('a notice carries no approval state at all', () => {
    const n = shopRegistrationNotice(shop())
    assert.deepEqual(
      Object.keys(n).sort(),
      ['at', 'detail', 'href', 'id', 'kind', 'title'],
      'a notice grew a field — if it is approval state, the feed has become a worklist',
    )
  })
})
