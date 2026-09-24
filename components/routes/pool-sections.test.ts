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
 * The delivery half is grouped by township, and the way is the office's own
 * choice (0049) -- nothing here may suggest one from the parcel's area.
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

  /**
   * 0049 REVERSED 0040 ON PURPOSE. The shelf used to be boxed by the way each
   * parcel's area maps to by default -- the board choosing the way. The office
   * chooses it now, so the shelf is boxed by township and nothing in the panel
   * may read a suggested way again.
   */
  test('the delivery half groups by township', () => {
    assert.match(
      SRC,
      /isHubHeld\s*\n?\s*\?\s*`area:\$\{p\.areaId/,
      'hub-held parcels are no longer keyed on their township',
    )
  })

  test('no way is suggested from the township', () => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.ok(!/suggestedRoute/.test(code), 'the panel is suggesting a way again')
  })

  /**
   * Sending on a new run needs a way the office picked: the select starts
   * empty, and the blocker names it.
   */
  test('a new run waits for the office to choose its way', () => {
    assert.match(SRC, /<option value="">Choose a way…<\/option>/)
    assert.match(SRC, /Choose a way for the new run\./)
  })

  /**
   * The pool is split into two tabs, pickups and deliveries, and switching tab
   * clears the ticks so a hidden selection can never be loaded.
   */
  test('pickup ways and delivery ways are separate tabs', () => {
    assert.match(SRC, /role="tab"/)
    assert.match(SRC, /'Pickup ways'/)
    assert.match(SRC, /'Delivery ways'/)
    assert.match(SRC, /setTab\(next\)[\s\S]{0,80}onClear\(\)/, 'switching tab no longer clears the ticks')
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
