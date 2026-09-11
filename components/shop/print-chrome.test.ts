import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Nothing pinned to the viewport may reach the paper.
 *
 * WHY THIS EXISTS. `/shop/orders/labels` is a print route: it sets
 * `@page { size: 100mm 150mm; margin: 0 }` and calls `window.print()` on
 * arrival. The page itself is careful — every on-screen control it owns carries
 * `print:hidden`. The shell around it was not: of the four chrome pieces the
 * shop layout mounts, only the header had the class.
 *
 * THE TRAP IS THAT `lg:hidden` LOOKS LIKE IT COVERS THIS. The tab bar and the
 * New Order pill are phone-only, so on the desktop where anyone would test
 * printing they are already gone. But a print job lays out at the PAPER width,
 * and this route's paper is 100mm — far below `lg`. So the responsive class
 * keeps them VISIBLE exactly when printing, and because they are `position:
 * fixed` the browser paints them onto every page of the job. A ten-parcel batch
 * came out with ten tab bars, one across the bottom of each waybill.
 *
 * A screenshot test would catch it. There is no DOM harness here, so this is a
 * source scan — the same shape as `shop-nav.test.ts` and the RSC-boundary scan
 * in `lib/i18n/dictionary.test.ts`.
 */

const FILES = {
  'components/shop/shop-nav.tsx': new URL('./shop-nav.tsx', import.meta.url),
  'components/legal/policy-gate.tsx': new URL(
    '../legal/policy-gate.tsx',
    import.meta.url,
  ),
  'components/orders/shop-parcel-alert.tsx': new URL(
    '../orders/shop-parcel-alert.tsx',
    import.meta.url,
  ),
  'app/shop/layout.tsx': new URL('../../app/shop/layout.tsx', import.meta.url),
} as const

/*
  ANCHORED TO `className`, not loose in the file. shop-nav.test.ts learned this
  the hard way: a bare /grid-cols-(\d+)/ matched the comment EXPLAINING the bug
  and reported the fix missing. Every comment above these very classes now says
  the words "fixed" and "print:hidden", so an unanchored scan here would read
  the prose and pass no matter what the code did.
*/
const PINNED = /className="((?:fixed|sticky)[^"]*)"/g

describe('shop print chrome', () => {
  for (const [name, url] of Object.entries(FILES)) {
    const src = readFileSync(url, 'utf8')
    const pinned = [...src.matchAll(PINNED)].map((m) => m[1]!)

    test(`${name}: every pinned element is hidden in print`, () => {
      for (const cls of pinned) {
        assert.ok(
          cls.includes('print:hidden'),
          `${name} has a pinned element without print:hidden:\n    ${cls}\n` +
            '  A fixed/sticky element prints on EVERY page of the job, and\n' +
            '  lg:hidden does not save you — print lays out at paper width.',
        )
      }
    })
  }

  /**
   * The scan is worthless if it stops finding anything — a refactor to
   * styled components or a `cn()` call would empty it silently and the suite
   * would still be green.
   */
  test('the scan still finds the chrome it is meant to guard', () => {
    const total = Object.values(FILES)
      .map((url) => [...readFileSync(url, 'utf8').matchAll(PINNED)].length)
      .reduce((a, b) => a + b, 0)
    assert.ok(
      total >= 3,
      `only ${total} pinned className(s) found across the shop shell — ` +
        'the scan has stopped seeing them, so it is no longer guarding anything',
    )
  })
})
