import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_NAV_ITEMS, ALLOWED_NAV_OVERLAP, SUPER_NAV_ITEMS } from './nav'

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
   * A dispatcher must never be shown a link middleware will bounce them off.
   * ROUTE_ROLES gates /admin/super, /admin/shops and /admin/audit to
   * super_admin, so every nav item under those prefixes has to be adminOnly.
   */
  test('everything a dispatcher can see is a route they may open', () => {
    const superAdminOnly = ['/admin/super', '/admin/shops', '/admin/audit']
    for (const item of ADMIN_NAV_ITEMS) {
      const restricted = superAdminOnly.some(
        (p) => item.href === p || item.href.startsWith(`${p}/`),
      )
      if (restricted) {
        assert.equal(item.adminOnly, true, `${item.href} must be adminOnly`)
      } else {
        assert.notEqual(item.adminOnly, true, `${item.href} need not be adminOnly`)
      }
    }
  })
})
