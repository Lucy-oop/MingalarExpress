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
   * removed — because the docblock above ShopStatTile explains why min-h-11 is
   * there, and the scan read its own documentation. That is the fourth time
   * this exact trap has come up in this repo; shop-nav.test.ts records the
   * first.
   */
  test('a count tile is a legal touch target', () => {
    const classNames = [...code(stats).matchAll(/className=(?:"([^"]*)"|\{[^}]*'([^']*)'[^}]*\})/g)]
      .map((m) => m[1] ?? m[2] ?? '')
      .join(' ')
    const tile = code(stats).slice(code(stats).indexOf('export function ShopStatTile'))
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

const money = readFileSync('app/shop/money/page.tsx', 'utf8')
const settings = readFileSync('app/shop/settings/page.tsx', 'utf8')
const newOrder = readFileSync('app/shop/orders/new/page.tsx', 'utf8')
const toggle = readFileSync('components/shared/language-toggle.tsx', 'utf8')
const bell = readFileSync('components/shared/notice-bell.tsx', 'utf8')

describe('the money page is the shop\'s, not the office\'s', () => {
  /**
   * Three of its five figures are money, so it had the dashboard's bug twice
   * over: a comma-grouped MMK total is one unbreakable token and a 126px admin
   * tile has no room for it.
   */
  test('it uses the shop tiles for its figures', () => {
    assert.match(code(money), /ShopMoneyCard|ShopStatTile/, 'the money page lost the shop tiles')
    assert.ok(
      !/\bKpi\b/.test(code(money)),
      'the admin Kpi is back on /shop/money — that is desk density on a phone',
    )
  })

  /** `PageHeader` is layout only — no 10px type — so it may stay shared. */
  test('what it still shares with admin is only the page header', () => {
    const imports = code(money).match(/from '@\/components\/admin\/[^']*'/g) ?? []
    assert.deepEqual(imports, ["from '@/components/admin/kpi'"])
    assert.match(code(money), /import \{ PageHeader \} from '@\/components\/admin\/kpi'/)
  })
})

describe('an empty state can be escaped with a thumb', () => {
  /**
   * Each of these is the ONLY way forward from a screen with nothing on it —
   * no shop yet, no pickup pin, cannot book. They were `size="sm"`: h-8, 32px,
   * with 12px type, below the 44px floor the rider suite enforces as a test.
   */
  test('every recovery CTA clears 44px', () => {
    for (const [name, src] of [
      ['dashboard', dashboard],
      ['settings', settings],
      ['orders/new', newOrder],
    ] as const) {
      assert.ok(
        !/buttonVariants\(\{ size: 'sm' \}\)/.test(code(src)),
        `${name} has a 32px recovery CTA again`,
      )
      assert.match(code(src), /min-h-11/, `${name} lost its 44px floor`)
    }
  })
})

describe('the shop header is one row on a phone', () => {
  /**
   * The contents came to ~440px against the 328px a 360px phone gives, so
   * flex-wrap dropped the action group to a second line — ~103px of chrome on
   * every phone before any content. Both halves shrank; neither was hidden.
   */
  test('the wordmark drops its second word on a phone', () => {
    assert.match(code(shopLayout), /<BrandMark[^>]*compact/, 'the header wordmark is full-width again')
  })

  test('the language toggle uses its short labels on a phone', () => {
    /*
      ANCHORED TO THE RENDER, NOT THE IMPORT. The first version matched
      /LOCALE_LABEL_SHORT/ anywhere and passed with the usage deleted, because
      the import line still carried the name. Same trap as the min-h-11 guard
      above, twice in one file.
    */
    assert.match(
      code(toggle),
      /<span className="sm:hidden">\{LOCALE_LABEL_SHORT\[l\]\}<\/span>/,
      'the toggle is back to ~152px of the bar',
    )
    assert.match(
      code(toggle),
      /<span className="hidden sm:inline">\{LOCALE_LABEL\[l\]\}<\/span>/,
      'the full labels no longer come back at sm',
    )
    // Both segments must remain — see the docblock; a single "switch to X"
    // button is the saving that breaks the rule.
    assert.match(code(toggle), /LOCALES\.map/, 'the toggle collapsed to one button')
  })

  /**
   * flex-wrap stays deliberately: it is what makes the worst case a taller bar
   * rather than a horizontally broken one. The fix is that it no longer fires.
   */
  test('wrapping survives as the valve, and the brand shrinks first', () => {
    assert.match(code(shopLayout), /flex-wrap/, 'the header lost its overflow valve')
    assert.match(code(shopLayout), /className="min-w-0 shrink"/, 'the brand cannot shrink, so the bar will wrap')
  })

  /** Two unlabelled targets side by side, one of which ends the session. */
  test('the bell and sign-out are 44px and not crowded', () => {
    assert.match(bell, /className="relative size-11"/, 'the bell is back to a 32px target')
    assert.match(code(shopLayout), /iconOnly className="size-11"/, 'sign-out is back to a 32px target')
    assert.match(code(shopLayout), /items-center gap-3 xl:ml-0/, 'the icons are crowded together again')
  })
})
