import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The shop dashboard is read on a 360px phone, in Burmese, by someone standing
 * in a shop. None of what follows would fail a build or any other test: the
 * page renders, it is simply built at the wrong density, and the failure mode
 * is a money figure crossing its own border.
 *
 * These live in lib/ rather than app/ on purpose — the `npm test` glob covers
 * lib, components, scripts and supabase, so a guard written under app/ runs as
 * nothing at all and the suite still goes green. That happened once already
 * this session; the total is the only thing that showed it.
 */
const dashboard = readFileSync('app/shop/dashboard/page.tsx', 'utf8')
const stats = readFileSync('components/shop/shop-stats.tsx', 'utf8')
const shopLayout = readFileSync('app/shop/layout.tsx', 'utf8')
const rootLayout = readFileSync('app/layout.tsx', 'utf8')
const skeleton = readFileSync('app/shop/loading.tsx', 'utf8')

/** Comments discuss all of this by name, so scan code only. */
const code = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('the shop dashboard is not the admin panel', () => {
  /**
   * components/admin/kpi.tsx says what it is for in its first line:
   * "Presentational tiles shared by the Super Admin pages." Importing it here
   * is what put text-[10px] uppercase labels on a shop owner's phone.
   */
  test('it does not import the office tiles', () => {
    assert.ok(
      !/from '@\/components\/admin\//.test(code(dashboard)),
      'the shop dashboard is importing admin components again — that is desk density on a phone',
    )
  })

  /**
   * formatMmk emits "1,250,000 Ks" — one unbreakable token, ~145px at 24px.
   * grid tracks are minmax(0,1fr) and will not grow, so without both of these
   * the digits render straight through the card's right edge.
   */
  test('the money figure cannot overflow its card', () => {
    const card = stats.slice(stats.indexOf('export function ShopMoneyCard'))
    assert.match(card, /min-w-0 truncate/, 'the COD figure can spill past its border again')
  })

  /** Uppercase + tracking-wide costs ~15% more width, and Burmese has no case. */
  test('no 10px type on the shop dashboard', () => {
    for (const [name, src] of [
      ['shop-stats', stats],
      ['dashboard', dashboard],
      ['loading', skeleton],
    ] as const) {
      assert.ok(!/text-\[10px\]/.test(code(src)), `${name} is back to 10px type`)
    }
  })

  /**
   * Three of the four counts are links; 44px is the floor the rider suite
   * enforces as a test of its own (job-panel.test.ts bans min-h-10).
   *
   * ANCHORED TO THE className, AND ON STRIPPED SOURCE. The first version of
   * this matched /min-h-11/ anywhere in the file and passed with the class
   * removed — because the docblock above ShopCountTile explains why min-h-11 is
   * there, and the scan read its own documentation. That is the fourth time
   * this exact trap has come up in this repo; shop-nav.test.ts records the
   * first.
   */
  test('a count tile is a legal touch target', () => {
    const classNames = [...code(stats).matchAll(/className=(?:"([^"]*)"|\{[^}]*'([^']*)'[^}]*\})/g)]
      .map((m) => m[1] ?? m[2] ?? '')
      .join(' ')
    const tile = code(stats).slice(code(stats).indexOf('export function ShopCountTile'))
    assert.match(
      tile,
      /'flex min-h-11 flex-col/,
      'the count tiles dropped below the 44px floor',
    )
    assert.ok(classNames.length > 0, 'no classNames found — the scan is looking at nothing')
  })

  /**
   * Two English string literals sat inside a t()-driven page, on a screen whose
   * default language is Burmese.
   */
  test('nothing on the page is hardcoded English', () => {
    for (const literal of ['Retry, return or cancel', 'failed in total']) {
      assert.ok(
        !code(dashboard).includes(literal),
        `"${literal}" is a literal again — it will not translate`,
      )
    }
  })
})

describe('the phone chrome adds up', () => {
  /**
   * THE ONE-LINE BUG THAT DISABLED EVERY OTHER FIX. Without viewportFit,
   * `env(safe-area-inset-bottom)` resolves to 0 in mobile Safari — silently —
   * so the shop tab bar, the rider tab bar and the rider's DONE bar all had
   * inset padding that did nothing on an iPhone.
   */
  test('the viewport opts into the safe area', () => {
    assert.match(
      code(rootLayout),
      /viewportFit: 'cover'/,
      'viewportFit is gone — every env(safe-area-inset-*) in the app silently becomes 0',
    )
  })

  /**
   * The FAB floats ABOVE the tab bar: 4rem bar + 1rem gap + 3rem button = its
   * top edge is 128px up, while the old pb-28 reserved 112px. The last 16px of
   * every shop page sat underneath it.
   */
  test('main reserves enough room for the FAB, not just the tab bar', () => {
    const main = code(shopLayout).match(/<main className="([^"]*)"/)?.[1] ?? ''
    assert.ok(main, 'could not find the shop main element')
    assert.ok(
      !/\bpb-28\b/.test(main),
      'main is back to pb-28 — the FAB covers the last 16px of every page',
    )
    assert.match(main, /pb-\[calc\([^\]]*safe-area-inset-bottom/, 'the bottom reserve ignores the inset')
  })

  /**
   * A skeleton whose shape differs from the page is worse than none: it moves
   * the layout at the exact moment the reader starts reading.
   */
  test('the skeleton is the shape the page renders', () => {
    assert.ok(
      !/grid-cols-2 gap-2 lg:grid-cols-4/.test(skeleton),
      'the skeleton draws 4 equal tiles again; the page draws a money card over a 2x2',
    )
    const tiles = (skeleton.match(/\[0, 1, 2, 3\]/g) ?? []).length
    assert.equal(tiles, 1, 'the skeleton no longer draws exactly four count tiles')
  })
})
