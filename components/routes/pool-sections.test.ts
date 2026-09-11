import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The office pool names its two halves, and the delivery half is a WAY.
 *
 * WHAT THIS PROTECTS. The board is where the day is split into collection runs
 * and delivery runs, and for a long time it never said so: one flat scroll
 * where a delivery group was marked by an amber badge reading "Out only" — a
 * phrase that never says *deliver* — and a collection group was identified by
 * having no badge at all. The rider app had proper headings the whole time; the
 * office did not.
 *
 * The delivery half also grouped by WARD, giving one box per area. With eight
 * wards across five routes that is a lot of boxes, none of which is the thing
 * the office hands to a rider. It groups by way now, wards inside.
 *
 * There is no DOM harness here, so this is a source scan — the same shape as
 * `shop-nav.test.ts` and `print-chrome.test.ts`. It cannot prove the layout
 * renders; it can prove nobody quietly took the names back out.
 */
const SRC = readFileSync(new URL('./unrouted-panel.tsx', import.meta.url), 'utf8')

describe('the office pool names its halves', () => {
  /*
    ANCHORED TO THE HEADING MAP, not loose in the file. The comments in this
    component now discuss "READY TO DELIVER" and "Out only" by name, so an
    unanchored search would read the prose explaining the change and pass
    regardless of what the code does. shop-nav.test.ts learned that one the
    hard way.
  */
  const headingMap = /KIND_HEADING[\s\S]{0,300}?\}/.exec(SRC)?.[0] ?? ''

  test('all three sections are named', () => {
    for (const heading of ['READY TO DELIVER', 'BACK TO A SHOP', 'TO COLLECT']) {
      assert.ok(headingMap.includes(heading), `${heading} is not in KIND_HEADING`)
    }
  })

  test('the delivery half groups by way, not by ward', () => {
    assert.match(
      SRC,
      /isHubHeld\s*\n?\s*\?\s*`way:\$\{p\.suggestedRouteId/,
      'hub-held parcels are no longer keyed on the route — one box per ward is back',
    )
  })

  /**
   * The wards have to survive the regrouping or the office loses the detail it
   * actually sorts by.
   */
  test('wards are still offered inside a way', () => {
    assert.match(SRC, /group\.areas\.map/, 'the ward chips are gone from the way box')
  })

  /**
   * "Out only" was the whole problem: the only word for the delivery half, and
   * it did not say deliver. It must not come back as a JSX string.
   */
  test('"Out only" is not rendered', () => {
    const jsx = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.ok(!jsx.includes('Out only'), '"Out only" is being rendered again')
  })

  /**
   * A return's COD is money nobody collects — the rows say "No fee" and the
   * header used to contradict them by summing it anyway.
   */
  test('a returns group sums no cash', () => {
    assert.match(
      SRC,
      /const cod = group\.isReturn\s*\n?\s*\?\s*0/,
      'the group COD total is not leg-aware again',
    )
  })
})
