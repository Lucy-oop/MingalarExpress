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

/**
 * WHERE A DELIVERY MAY BE COMMITTED, AND WHAT IT COSTS TO GET THERE.
 *
 * The owner asked for the DONE button to exist only in the detail view and to
 * stay disabled until a photo and a payment method are given. It already did
 * all three — and nothing tested any of it, which is why the request was
 * reasonable: from the outside there was no way to tell.
 *
 * What was actually wrong sat on the dashboard: a green, full-width button
 * reading "DONE — DELIVERED" that was a `<Link>`. It committed nothing. These
 * guards pin both halves — the gate that must stay, and the fake button that
 * must not come back.
 */
const dashboard = readFileSync('components/rider/rider-dashboard.tsx', 'utf8')

describe('a delivery can only be committed behind the gate', () => {
  /*
    ANCHORED TO THE `blocker` EXPRESSION, not loose in the file. The comments in
    these components discuss `proof`, `collectedVia` and "DONE — DELIVERED" by
    name, so an unanchored search would read the prose explaining the gate and
    pass whatever the code did.

    THE GATE MOVED, AND THESE FOLLOWED IT. It used to be a four-clause boolean
    written inline on the Button's `disabled`; it is now one `blocker`
    expression that the button and the helper text both read, so the two can no
    longer disagree about whether the button is off and why. Slicing from `const
    blocker` skips its own docblock, which sits above.
  */
  const blockerStart = actions.indexOf('const blocker')
  const gate = actions.slice(blockerStart, actions.indexOf('const onDelivered', blockerStart))

  test('the delivery button is gated at all', () => {
    assert.ok(blockerStart > -1, 'there is no blocker expression — the gate is gone')
    assert.match(
      actions,
      /disabled=\{busy !== null \|\| completed \|\| blocker !== null\}/,
      'the delivery button no longer reads blocker — it can be pressed past the gate',
    )
  })

  test('a photo is required', () => {
    assert.match(gate, /!proof/, 'the proof gate is gone from the delivery button')
  })

  test('a payment method is required when there is cash to collect', () => {
    assert.match(
      gate,
      /needsPayment\s*&&\s*collectedVia === null/,
      'a COD delivery can be committed without saying how it was paid',
    )
  })

  test('a KPay delivery also needs its receipt', () => {
    assert.match(
      gate,
      /collectedVia === 'kpay'\s*&&\s*!kpayProof/,
      'a KPay delivery can be committed with no transfer screenshot',
    )
  })

  /**
   * THE HELPER TEXT IS THE POINT OF THE REFACTOR. A disabled button with no
   * explanation is indistinguishable from a broken app, and the commonest case
   * by far — photo taken, payment question not yet answered — used to produce
   * exactly that. The hint must ride inside the ActionBar, because a hint
   * rendered in page flow can be scrolled away from the button it explains.
   */
  test('and the bar says which thing is still missing', () => {
    const bar = actions.slice(actions.lastIndexOf('<ActionBar>', actions.indexOf('markDelivered')))
    assert.match(bar, /\{t\(blocker\)\}/, 'the disabled button no longer explains itself')
  })

  /**
   * The commit must stay in one place. `advanceOrder` reaching the dashboard
   * would mean a delivery could be marked done without ever meeting the gate
   * above — which is exactly what the old green button looked like it did.
   */
  test('the dashboard cannot commit a delivery', () => {
    assert.ok(
      !/advanceOrder\b/.test(dashboard),
      'rider-dashboard imports advanceOrder — the gate can now be bypassed',
    )
  })

  /**
   * A navigation link must not wear a commit label. This one said
   * "DONE — DELIVERED" and "I HAVE THE PARCEL" depending on the leg, and did
   * neither.
   */
  test('no commit label sits on a dashboard link', () => {
    const jsx = dashboard.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    for (const key of ['action.markDelivered', 'action.markPickedUp', 'parcel.returnTo']) {
      assert.ok(!jsx.includes(key), `${key} is back on the dashboard — it commits nothing there`)
    }
  })
})

describe('the next stop card opens on a tap', () => {
  test('the card body is a link to the job', () => {
    assert.match(
      dashboard,
      /<Link\s+href=\{`\/rider\/jobs\/\$\{next\.id\}`\}\s+className="block/,
      'the next-stop card body is not a link — only a button navigates again',
    )
  })

  /**
   * Call and Navigate are `<a>` elements. An anchor inside an anchor is
   * invalid HTML that browsers resolve by guessing, which is why `JobCard`
   * carries the note "no nested links or buttons". They must stay siblings of
   * the card link, not children of it.
   */
  test('and the call and map links are not nested inside it', () => {
    const start = dashboard.indexOf('className="block space-y-2')
    const end = dashboard.indexOf('</Link>', start)
    const body = dashboard.slice(start, end)
    assert.ok(!body.includes('tel:'), 'the call link is nested inside the card link')
    assert.ok(!body.includes('maps/dir'), 'the map link is nested inside the card link')
  })
})

/**
 * The cash card must show the BAG, not the net.
 *
 * `rider_cod_in_hand` subtracts pay owed, so on a route day it goes negative
 * while the rider is carrying a full bag. Both surfaces used to read it: the
 * earnings card printed a negative number under the words "cash you are
 * holding" next to "Nothing outstanding.", and the dashboard's warning — gated
 * on `> 0` — vanished exactly when there was most cash to warn about.
 *
 * `cash_held` (0041) is `cod_collected + cod_remitted` and is what both should
 * read. Reverting either to `codInHand` reintroduces a money bug that looks
 * like a blank space, so it is worth a guard.
 */
const earningsPage = readFileSync('app/rider/earnings/page.tsx', 'utf8')

describe('the cash figure is the bag', () => {
  test('the earnings card prints cash_held', () => {
    assert.match(
      earningsPage,
      /formatMmk\(cashHeld\)/,
      'the cash card is printing the net position again',
    )
  })

  test('and its explanation is no longer gated on a positive number', () => {
    assert.ok(
      !earningsPage.includes("codInHand > 0\n              ? 'This is COD"),
      'the contradictory "Nothing outstanding." branch is back',
    )
  })

  test("the dashboard's cash warning reads the bag too", () => {
    assert.match(
      dashboard,
      /feed\.earnings\.cashHeld > 0/,
      'the dashboard warning is gated on the net again — it will vanish when it matters',
    )
  })

  /** A route rider's biggest ledger line rendered as the raw enum string. */
  test('trip_pay has a human label', () => {
    assert.match(earningsPage, /trip_pay: '/, 'trip_pay is missing from LEDGER_LABEL again')
  })
})

/**
 * The navigation and layout asks from the owner's round of UI feedback.
 *
 * Every one of these is invisible to a type and to every other test: the app
 * stays correct and simply goes back to the shape that was reported as
 * confusing. That is exactly the class of change that regresses silently.
 */
describe('the rider can reach all three of their screens', () => {
  /**
   * Way history used to be a text-sm link in the top-right corner of the
   * earnings page — diagonally opposite the thumb on a one-handed screen, and
   * the only route to a whole section of the app.
   */
  test('history is a tab, not a corner link', () => {
    assert.match(tabs, /\/rider\/ways/, 'the history tab is gone from the bottom bar')
    assert.match(tabs, /grid-cols-3/, 'the tab bar is no longer three across')
    assert.ok(
      !/href="\/rider\/ways"/.test(earningsPage),
      'the corner link to way history is back on the earnings page',
    )
  })

  /**
   * All three tabs used to render in the same muted grey on every route, so the
   * bar showed where a rider could go and never where they were.
   */
  test('the current tab is lit in the brand red', () => {
    assert.match(tabs, /aria-current=\{active \? 'page' : undefined\}/, 'no tab reports itself current')
    assert.match(tabs, /font-bold text-primary/, 'the active tab is no longer the brand red')
  })
})

describe('the job screen leads with the money and nothing else', () => {
  /**
   * "You earn" appeared on this card for the first time when migration 0043
   * stamped the in-flight parcels — directly under "Collect from customer", one
   * bold figure beneath another. That card answers ONE question, asked at a
   * doorstep with a customer waiting: how much do I ask for. A second amount in
   * the same frame is a number the rider has to actively not say out loud.
   */
  test('the door card shows no earnings figure', () => {
    const code = jobPage.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    assert.ok(
      !code.includes('money.youEarn'),
      "'You earn' is back on the collect-from-customer card — see the docblock",
    )
  })

  /** The one figure said out loud at the gate, taken out of the <dl> and given
      a filled block of its own so it is read rather than parsed. */
  test('the collectable total is a filled block', () => {
    assert.match(jobPage, /bg-brand-gold\/15/, 'the total at the door is back inside the plain table')
  })

  /**
   * `lat`/`lng` are NULL for a shop that registered on its address alone, and
   * the address was then dead text. An https maps search works on iOS too,
   * where a `geo:` URI fails silently.
   */
  test('an address with no pin is still tappable', () => {
    assert.match(
      jobPage,
      /google\.com\/maps\/search/,
      'the no-pin address is dead text again — the rider has nothing to tap',
    )
  })
})

describe('nothing wears a coloured left stripe', () => {
  /**
   * Asked for explicitly, and app-wide rather than on the rider screens alone.
   * The two that carried real information — route colour, on the rider's run
   * strip and the office's trip card — kept it: a dot on the run strip, and on
   * the board the section heading that already names the route in its colour.
   */
  test('no component reintroduces border-l-4', () => {
    const roots = ['components/rider', 'components/routes', 'app/rider']
    const offenders = []
    for (const dir of roots) {
      for (const f of readdirSync(dir)) {
        if (!/\.tsx$/.test(f)) continue
        const src = readFileSync(`${dir}/${f}`, 'utf8')
        if (/border-l-4|border-l-\[/.test(src)) offenders.push(`${dir}/${f}`)
      }
    }
    assert.deepEqual(offenders, [], `left-border stripes are back in: ${offenders.join(', ')}`)
  })
})
