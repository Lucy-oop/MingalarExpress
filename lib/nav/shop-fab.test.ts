import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { showsNewOrderFab, FAB_ROUTES } from './shop-fab'

/**
 * The floating New Order button, asked directly rather than scanned for.
 *
 * On /shop/orders/new it was a shortcut to the page the shop was already on —
 * a control that looks like the most important thing on the screen and does
 * nothing when pressed — floating over the bottom of the form, which is where
 * the form's own primary action lives. `SubmitButton` is `size="touch"` and
 * `block`, deliberately the one full-width control down there, and the FAB sat
 * on top of it and of the line explaining why it was disabled.
 */
describe('the FAB is gone from the booking form', () => {
  /** The one the owner asked for, stated the way they asked for it. */
  test('it evaluates to nothing on /shop/orders/new', () => {
    assert.equal(showsNewOrderFab('/shop/orders/new'), false)
  })

  test('and on every other route under /shop/orders', () => {
    for (const path of [
      '/shop/orders/new',
      '/shop/orders/labels',
      '/shop/orders/export',
      '/shop/orders/3f1c8a20-0000-4000-8000-000000000001',
    ]) {
      assert.equal(showsNewOrderFab(path), false, `${path} still floats a New Order button`)
    }
  })

  /**
   * A prefix test would pass every case above except this one — and this is the
   * case the change exists for, since /shop/orders/new begins with the route
   * the FAB legitimately shows on.
   */
  test('but the parcels list itself keeps it', () => {
    assert.equal(showsNewOrderFab('/shop/orders'), true)
  })
})

describe('it shows on the overview screens and nowhere else', () => {
  test('the three it belongs on', () => {
    for (const path of ['/shop/dashboard', '/shop/orders', '/shop/money']) {
      assert.equal(showsNewOrderFab(path), true, `${path} lost its New Order button`)
    }
  })

  test('and not on settings, setup, notifications or the policy gate', () => {
    for (const path of [
      '/shop/settings',
      '/shop/setup',
      '/shop/notifications',
      '/shop/policy/cod-advance',
    ]) {
      assert.equal(showsNewOrderFab(path), false, `${path} floats a New Order button`)
    }
  })

  test('a trailing slash is the same page', () => {
    assert.equal(showsNewOrderFab('/shop/dashboard/'), true)
    assert.equal(showsNewOrderFab('/shop/orders/'), true)
  })

  test('no pathname at all is not a shop page', () => {
    assert.equal(showsNewOrderFab(null), false)
    assert.equal(showsNewOrderFab(undefined), false)
    assert.equal(showsNewOrderFab(''), false)
  })

  /**
   * THE POINT OF AN ALLOWLIST, checked against the filesystem so it stays true.
   *
   * Every shop route that exists is either on the list deliberately or gets no
   * FAB. A denylist would have the opposite default: a page added tomorrow
   * would float a button over whatever it contains until somebody noticed.
   */
  test('every shop route that exists has a deliberate answer', () => {
    const routes: string[] = []
    const walk = (dir: string, base: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${dir}/${entry.name}`, `${base}/${entry.name}`)
        else if (entry.name === 'page.tsx') routes.push(base || '/')
      }
    }
    walk('app/shop', '/shop')

    assert.ok(routes.length >= 8, `only ${routes.length} shop routes found — wrong directory?`)
    for (const route of routes) {
      const shown = showsNewOrderFab(route.replace(/\[[^\]]+\]/g, 'x'))
      const listed = FAB_ROUTES.includes(route)
      assert.equal(
        shown,
        listed,
        `${route}: FAB ${shown ? 'shows' : 'does not show'} but the allowlist says ${listed}`,
      )
    }
  })
})

describe('the form keeps one primary action at its foot', () => {
  const form = readFileSync('components/orders/order-form.tsx', 'utf8')

  /**
   * The FAB is gone from that route, so nothing should reintroduce a second
   * full-width control beside the submit. `size="touch"` + `block` is what
   * makes BOOK THIS PARCEL unambiguous.
   */
  test('the submit is the full-width touch-sized one', () => {
    const submit = form.slice(form.indexOf('function SubmitButton'), form.indexOf('book.submitting'))
    assert.match(submit, /size="touch"/, 'the booking submit shrank below 56px')
    assert.match(submit, /\bblock\b/, 'the booking submit is no longer full width')
  })

  /** The reason it is disabled has to sit with it, not behind a floating button. */
  test('the blocker message renders under the submit', () => {
    const tail = form.slice(form.indexOf('<SubmitButton'))
    assert.match(tail, /BLOCKER_MESSAGE\[blocker\]/, 'the "why is this disabled" line is gone')
  })
})
