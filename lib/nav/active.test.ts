import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { activeHref } from './active'

/**
 * The shop shell's five destinations, plus the booking route.
 *
 * Kept in step with `MATCHABLE` in components/shop/shop-nav.tsx by hand. The
 * duplication is deliberate — this file tests the matcher, not the component —
 * but a destination added there and not here is simply untested, which is how
 * /shop/notifications nearly shipped uncovered.
 */
const SHOP = [
  '/shop/dashboard',
  '/shop/orders',
  '/shop/notifications',
  '/shop/money',
  '/shop/settings',
  '/shop/orders/new',
] as const

describe('activeHref — the shop shell', () => {
  test('each destination lights itself', () => {
    assert.equal(activeHref('/shop/dashboard', SHOP), '/shop/dashboard')
    assert.equal(activeHref('/shop/money', SHOP), '/shop/money')
    assert.equal(activeHref('/shop/settings', SHOP), '/shop/settings')
    assert.equal(activeHref('/shop/orders', SHOP), '/shop/orders')
    assert.equal(activeHref('/shop/notifications', SHOP), '/shop/notifications')
  })

  test('a parcel and the label sheet both keep Parcels lit', () => {
    assert.equal(activeHref('/shop/orders/5d0ff37e-d153-4369-99db-0c9741e4d491', SHOP), '/shop/orders')
    assert.equal(activeHref('/shop/orders/labels', SHOP), '/shop/orders')
  })

  /**
   * THE CASE THIS MODULE EXISTS FOR. /shop/orders/new is a prefix match for
   * /shop/orders, so a naive startsWith lights "Parcels" while the shop is
   * booking. Booking is an action with its own button, not a destination, so
   * the longer href has to win -- and because it does, no caller needs an
   * exclusion list.
   */
  test('booking lights the booking route, NOT Parcels', () => {
    assert.equal(activeHref('/shop/orders/new', SHOP), '/shop/orders/new')
    assert.notEqual(activeHref('/shop/orders/new', SHOP), '/shop/orders')
  })

  test('the order of the list does not decide the winner', () => {
    // Reversed, so /shop/orders is seen before /shop/orders/new.
    const reversed = [...SHOP].reverse()
    assert.equal(activeHref('/shop/orders/new', reversed), '/shop/orders/new')
  })

  test('siblings never match each other', () => {
    assert.notEqual(activeHref('/shop/dashboard', SHOP), '/shop/orders')
    assert.notEqual(activeHref('/shop/settings', SHOP), '/shop/money')
  })
})

describe('activeHref — matching rules', () => {
  test('an unknown path lights nothing', () => {
    assert.equal(activeHref('/shop/reports', SHOP), null)
    assert.equal(activeHref('/admin/orders', SHOP), null)
    assert.equal(activeHref('/', SHOP), null)
  })

  /**
   * The `/` delimiter, not a bare startsWith: '/shop/order' must not match
   * '/shop/orders', or a nav item lights for a page in another section.
   */
  test('a prefix that is not a path segment does not match', () => {
    assert.equal(activeHref('/shop/ordersomething', ['/shop/orders']), null)
    assert.equal(activeHref('/shop/orders-archive', ['/shop/orders']), null)
  })

  test('a trailing slash is the same page', () => {
    assert.equal(activeHref('/shop/orders/', SHOP), '/shop/orders')
    assert.equal(activeHref('/shop/orders/new/', SHOP), '/shop/orders/new')
  })

  /** Callers compare the result back with === against their own array. */
  test('the caller gets its own string back, trailing slash and all', () => {
    const withSlash = ['/shop/orders/'] as const
    assert.equal(activeHref('/shop/orders/labels', withSlash), '/shop/orders/')
  })

  test('an empty list lights nothing', () => {
    assert.equal(activeHref('/shop/orders', []), null)
  })
})

describe('activeHref — the Super Admin sub-nav it came from', () => {
  const SUPER = [
    '/admin/super',
    '/admin/super/areas',
    '/admin/super/pricing',
    '/admin/super/riders',
    '/admin/super/settlements',
  ] as const

  /** The behaviour the inline version had; the extraction must not change it. */
  test('a settlement detail page keeps Settlements lit', () => {
    assert.equal(
      activeHref('/admin/super/settlements/abc-123', SUPER),
      '/admin/super/settlements',
    )
  })

  test('the index does not swallow its own children', () => {
    assert.equal(activeHref('/admin/super/areas', SUPER), '/admin/super/areas')
    assert.equal(activeHref('/admin/super', SUPER), '/admin/super')
  })
})

describe('activeHref — exact-match entries', () => {
  const SUB = ['/admin/super', '/admin/super/areas', '/admin/super/pricing'] as const
  const opts = { exact: ['/admin/super'] }

  /**
   * THE BUG THIS OPTION EXISTS FOR. `/admin/super` is a prefix of every page in
   * the section, so once Riders and Settlements were removed from the sub-nav
   * there was nothing longer to beat it — and the bar lit "Overview" while the
   * reader was standing on Riders.
   */
  test('a section index does not light for its children', () => {
    assert.equal(activeHref('/admin/super/riders', SUB, opts), null)
    assert.equal(activeHref('/admin/super/settlements/abc', SUB, opts), null)
  })

  test('but it still lights for itself', () => {
    assert.equal(activeHref('/admin/super', SUB, opts), '/admin/super')
    assert.equal(activeHref('/admin/super/', SUB, opts), '/admin/super')
  })

  test('siblings are unaffected and still prefix-match', () => {
    assert.equal(activeHref('/admin/super/areas', SUB, opts), '/admin/super/areas')
    assert.equal(activeHref('/admin/super/pricing/x', SUB, opts), '/admin/super/pricing')
  })

  /** Without the option the old behaviour is intact — the top bar relies on it. */
  test('omitting the option changes nothing', () => {
    assert.equal(activeHref('/admin/super/riders', SUB), '/admin/super')
  })
})
