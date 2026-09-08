import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

/**
 * Source guards on the rider job screen, in the same spirit as
 * `components/shop/shop-nav.test.ts`: these are invariants a type cannot hold
 * and this repo has no DOM harness, so the check is on the source.
 */
const panel = readFileSync('components/rider/job-panel.tsx', 'utf8')
const actions = readFileSync('components/rider/job-actions.tsx', 'utf8')
const jobPage = readFileSync('app/rider/jobs/[id]/page.tsx', 'utf8')
const tabs = readFileSync('components/rider/rider-tabs.tsx', 'utf8')

describe('the GPS fix survived the map removal', () => {
  /**
   * THE THING MOST LIKELY TO BE LOST IN THIS REFACTOR, and it would not break a
   * build or fail any other test.
   *
   * `JobPanel` holds a one-shot geolocation fix, and `advance_order` stamps it
   * onto `order_status_events` — which is what makes a COD dispute answerable
   * later. It used to live beside the map because the map wanted a centre; the
   * map is gone and the fix must not have gone with it. If it does, riders'
   * checkpoints quietly stop carrying a location and nobody finds out until
   * somebody's money is in question.
   */
  test('the panel still takes a geolocation fix', () => {
    assert.match(panel, /getCurrentPosition/, 'the GPS fix is gone — see the docblock')
  })

  test('and still hands it to JobActions', () => {
    assert.match(panel, /position=\{position\}/, 'the fix is taken but never passed on')
    assert.match(actions, /position\?\.lat/, 'JobActions no longer stamps the position')
  })
})

describe('the map left the rider path', () => {
  const riderFiles = [
    ...readdirSync('components/rider').map((f) => `components/rider/${f}`),
    'app/rider/jobs/[id]/page.tsx',
    'app/rider/layout.tsx',
    'app/rider/dashboard/page.tsx',
  ].filter((f) => /\.tsx$/.test(f))

  /**
   * 152 KB of Leaflet, for a canvas that mostly showed "Loading map…" on Yangon
   * mobile data and pushed the primary action below the fold. Riders read the
   * address and hand off to their own maps app. `MapCanvas` stays where someone
   * PICKS a point — shop settings, admin coverage — and must not creep back
   * here.
   */
  test('no rider component imports the map', () => {
    for (const f of riderFiles) {
      const src = readFileSync(f, 'utf8')
      assert.ok(
        !/@\/components\/map/.test(src),
        `${f} imports the map — riders do not pick coordinates, they navigate`,
      )
    }
  })
})

describe('the action bar is reachable and clears the system bars', () => {
  /**
   * The primary control was the LAST thing on the page, below the map. It now
   * portals into a fixed bar, which means it has to clear the iOS home
   * indicator and the Android gesture bar — the same padding the tab bar used.
   */
  test('the bar respects the safe area', () => {
    assert.match(actions, /env\(safe-area-inset-bottom\)/, 'the bar can sit under the gesture bar')
  })

  /**
   * Two fixed bars would eat about a third of a 640px viewport, so the tabs
   * step aside on a job screen. If this guard fails, the action bar and the tab
   * bar are stacked or overlapping.
   */
  test('the tabs step aside on a job screen', () => {
    assert.match(tabs, /\/rider\/jobs\//, 'RiderTabs no longer hides on a job screen')
    assert.match(tabs, /return null/, 'RiderTabs never hides itself')
  })

  /**
   * The portal must degrade to rendering in place. Before hydration — and if it
   * ever cannot mount — a rider must still see the only control that finishes
   * the job.
   */
  test('and the buttons render in place if the portal cannot mount', () => {
    assert.match(actions, /if \(!mounted\) return <>\{children\}<\/>/)
  })
})

describe('the address card', () => {
  /**
   * These four links were the ONLY sub-44px targets left on the rider surface,
   * at min-h-10 (40px), and they wrapped to a half-width orphan at 360px. They
   * are also the two things a rider does most: ring the person, start driving.
   */
  test('its actions are touch-sized, not 40px links', () => {
    /*
      ANCHORED TO className, because the first version of this matched its own
      documentation: the comment above the grid explains what the old
      `min-h-10` links were, and a bare pattern found that instead of any code.
      Same trap as the grid-cols-4 guard in shop-nav.test.ts.
    */
    const classes = [...jobPage.matchAll(/className=(?:"([^"]*)"|\{[^}]*"([^"]*)"[^}]*\})/g)]
      .map((m) => m[1] ?? m[2] ?? '')
      .join(' ')
    assert.ok(!/\bmin-h-10\b/.test(classes), 'a 40px target is back on the job page')
    assert.match(classes, /grid-cols-2/, 'the actions are not in a fixed two-up grid')
  })

  /** The OSM link duplicated Navigate and was the fourth small target. */
  test('the duplicate OpenStreetMap link is gone', () => {
    assert.ok(!/openstreetmap\.org/.test(jobPage), 'the OSM link is back')
  })
})
