import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { ROUTE_ROLES } from '../auth/routes'
import {
  ADMIN_NAV_EXACT,
  ADMIN_NAV_ITEMS,
  ALLOWED_NAV_OVERLAP,
  SUPER_NAV_ITEMS,
} from './nav'

describe('admin navigation', () => {
  /**
   * THE REGRESSION THIS FILE EXISTS FOR.
   *
   * Five of the sub-nav's seven items were the same label pointing at the same
   * href as a top-bar link: Overview, Riders, Shops, Settlements, COD audit. A
   * super admin on /admin/super/riders saw fifteen links for nine destinations
   * with "Riders" appearing twice, one of them aimed at the page they were
   * already standing on.
   *
   * Nothing prevented it and nothing would have caught it growing back — a new
   * page gets added to both lists because adding it to both feels thorough.
   */
  test('no destination appears in both navigation bars', () => {
    const top = new Set(ADMIN_NAV_ITEMS.map((i) => i.href))
    const overlap = SUPER_NAV_ITEMS.map((i) => i.href).filter(
      (href) => top.has(href) && !ALLOWED_NAV_OVERLAP.includes(href),
    )
    assert.deepEqual(
      overlap,
      [],
      `these hrefs are in the top bar AND the sub-nav: ${overlap.join(', ')}`,
    )
  })

  /**
   * Overview is the one sanctioned overlap: it is the section's own index, and
   * without it Coverage and Pricing have no way back except the top bar. Pinned
   * so the exception stays deliberate rather than becoming a place to park the
   * next duplicate.
   */
  test('the allowed overlap is Overview and nothing else', () => {
    assert.deepEqual([...ALLOWED_NAV_OVERLAP], ['/admin/super'])
  })

  /** Coverage and Pricing exist nowhere else; losing them strands two pages. */
  test('the sub-nav still carries the pages that live only there', () => {
    const sub = SUPER_NAV_ITEMS.map((i) => i.href)
    assert.ok(sub.includes('/admin/super/areas'), 'Coverage')
    assert.ok(sub.includes('/admin/super/pricing'), 'Pricing')
  })

  test('every item has a label and an href, and no href repeats within a list', () => {
    for (const list of [ADMIN_NAV_ITEMS, SUPER_NAV_ITEMS]) {
      const hrefs = list.map((i) => i.href)
      assert.equal(new Set(hrefs).size, hrefs.length, 'duplicate href within one list')
      for (const item of list) {
        assert.ok(item.href.startsWith('/admin'), item.href)
        assert.ok(item.label.trim().length > 0, item.href)
      }
    }
  })

  /**
   * NOBODY IS SHOWN A LINK MIDDLEWARE WILL BOUNCE THEM OFF.
   *
   * This replaces "everything a dispatcher can see is a route they may open",
   * which checked that every nav item under an admin-only prefix carried
   * `adminOnly`. That flag is gone with the dispatcher role, so the old test
   * would have passed while asserting nothing.
   *
   * It also duplicated middleware's prefix list as a literal, so the two could
   * drift silently. This imports the REAL `ROUTE_ROLES` and asks the real question: can
   * the office role actually open every destination the office is shown? A new
   * /admin route gated to some future role, still listed in the top bar, fails
   * here rather than 404-ing in somebody's face.
   */
  test('every destination in the bar is one the office may open', () => {
    // Same longest-prefix rule middleware applies.
    const prefixes = Object.keys(ROUTE_ROLES).sort((a, b) => b.length - a.length)

    for (const item of [...ADMIN_NAV_ITEMS, ...SUPER_NAV_ITEMS]) {
      const prefix = prefixes.find(
        (p) => item.href === p || item.href.startsWith(`${p}/`),
      )
      assert.ok(prefix, `${item.href} matches no ROUTE_ROLES prefix — is it even gated?`)
      assert.ok(
        ROUTE_ROLES[prefix]!.includes('super_admin'),
        `${item.href} is gated to ${ROUTE_ROLES[prefix]!.join('/')}, which the office is not`,
      )
    }
  })

  /**
   * The landing page prefixes every other destination, so as an ordinary entry
   * it would light "Runs" on any /admin page without a nav item of its own.
   * SUPER_NAV_EXACT exists because this exact bug already happened once in the
   * sub-nav; this is the top bar's version of that guard.
   */
  test('the landing page is exact-match only', () => {
    assert.ok(
      ADMIN_NAV_EXACT.includes('/admin'),
      '/admin prefixes every other item and must not light as a prefix',
    )
    for (const href of ADMIN_NAV_EXACT) {
      assert.ok(
        ADMIN_NAV_ITEMS.some((i) => i.href === href),
        `${href} is marked exact but is not in the bar`,
      )
    }
  })
})
