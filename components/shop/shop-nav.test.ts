import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * A source-level guard, in the same spirit as the RSC-boundary scan in
 * `lib/i18n/dictionary.test.ts`.
 *
 * WHY IT EXISTS. `ShopTabs` renders `NAV` into a `grid-cols-N` — and a Tailwind
 * class cannot be derived from `NAV.length` without defeating the JIT, so the
 * two are coupled by hand. Adding the Updates page put a fifth destination into
 * a four-column grid: the fifth tab wrapped onto a second row and doubled the
 * height of a FIXED bottom bar, covering content on every phone. Nothing caught
 * it — not tsc, not the build, not the nav matcher tests, because none of them
 * can see a layout.
 *
 * This is the cheapest thing that would have.
 */
const SRC = readFileSync(new URL('./shop-nav.tsx', import.meta.url), 'utf8')

describe('the shop tab bar matches the nav', () => {
  const destinations = (SRC.match(/href: '\/shop\//g) ?? []).length
  /*
    ANCHORED TO THE className, not loose in the file. The first version matched
    /grid-cols-(\d+)/ anywhere and found `grid-cols-4` inside the comment
    explaining the bug — so the test read the prose describing the fix and
    reported the fix missing. A source-scanning test has to look at code.
  */
  const cols = Number(/className="grid grid-cols-(\d+)"/.exec(SRC)?.[1] ?? 0)

  test('there is a NAV list and a column count to compare', () => {
    assert.ok(destinations > 0, 'no NAV destinations found — has the shape changed?')
    assert.ok(cols > 0, 'no grid-cols-N found in ShopTabs')
  })

  /**
   * THE ONE THAT MATTERS. A mismatch does not fail the build; it wraps a fixed
   * bar onto a second row, which only a human looking at a phone would notice.
   */
  test('one column per destination', () => {
    assert.equal(
      cols,
      destinations,
      `ShopTabs has grid-cols-${cols} for ${destinations} destinations — ` +
        'the extra tabs wrap onto a second row and double the height of the fixed bar',
    )
  })

  /**
   * Five is the practical ceiling for a thumb bar on a 360px screen: 72px a
   * tab. Past that the labels stop being readable and the targets stop being
   * hittable, and the answer is a different navigation model, not a sixth
   * column.
   */
  test('and no more than five, which is what a phone can hold', () => {
    assert.ok(destinations <= 5, `${destinations} tabs will not fit a phone`)
  })
})

describe('the header nav cannot re-create the Burmese gap', () => {
  const HEADER = readFileSync(new URL('../../app/shop/layout.tsx', import.meta.url), 'utf8')

  /**
   * The bug: the nav took only its content width at `xl` while the action
   * group used `ml-auto`, so the unused space opened as a gap between them —
   * sized by whatever the translated labels did not consume, which is why it
   * appeared in Burmese and not in English.
   *
   * Asserting the fix rather than the symptom: the nav must be able to absorb
   * the slack, and it cannot do that with a content-width class.
   */
  /** Same lesson as above: read the className, not the comment beside it. */
  const navClass = /<ShopNavLinks className="([^"]+)"/.exec(HEADER)?.[1] ?? ''

  test('the header nav grows to fill the bar at xl', () => {
    assert.ok(navClass.length > 0, 'could not find the ShopNavLinks className')
    assert.match(navClass, /xl:flex-1/, 'the nav no longer absorbs the header slack')
    assert.ok(
      !/xl:w-auto/.test(navClass),
      'xl:w-auto is back — the nav will take content width and ml-auto will open a gap again',
    )
  })

  /**
   * A horizontal scrollbar under a desktop primary nav hides tabs and reads as
   * broken. It was in here as a hedge against exactly the Burmese overflow —
   * which is how a hedge becomes the bug. The five tabs fit by construction
   * now, so the valve has to stay gone or the hedge returns.
   */
  test('the header nav does not scroll horizontally', () => {
    assert.ok(
      !/overflow-x-auto/.test(navClass),
      'the desktop nav is scrolling again — make the tabs fit instead',
    )
  })

  /**
   * The room the tabs fit in. If a label grows back, or the padding does, the
   * five stop fitting at xl and there is no valve left to hide it.
   */
  test('the tab labels and their chrome stay compact', () => {
    const linkClass = /'flex shrink-0 items-center ([^']*)'/.exec(SRC)?.[1] ?? ''
    assert.ok(linkClass.length > 0, 'could not find the nav link className')
    assert.match(linkClass, /whitespace-nowrap/, 'a label that wraps is a second row by another name')
    assert.ok(!/px-3\b/.test(linkClass), 'px-3 is back — that is 40px across five tabs')
  })

  /** With the nav on flex-1, `ml-auto` at xl is what re-opens the gap. */
  test('and the action group stops right-aligning against it', () => {
    const actions = /<div className="(ml-auto[^"]+)"/.exec(HEADER)?.[1] ?? ''
    assert.ok(actions.length > 0, 'could not find the header action group')
    assert.match(actions, /xl:ml-0/, 'the action group will be pushed away from the nav again')
  })
})
