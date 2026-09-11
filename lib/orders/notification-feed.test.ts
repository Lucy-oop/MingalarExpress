import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The shop feed's upgrade: what it says, and what happens when it is tapped.
 * Source guards, in the absence of a DOM harness — none of these would fail a
 * build if removed, and each one is a thing a shop would notice and nothing
 * else would.
 */
const queries = readFileSync('lib/orders/queries.ts', 'utf8')
const row = readFileSync('components/orders/notification-row.tsx', 'utf8')
const detail = readFileSync('components/orders/notification-detail.tsx', 'utf8')
const actions = readFileSync('lib/orders/notification-actions.ts', 'utf8')

describe('the feed says who and where', () => {
  /**
   * `profiles_read_self_or_dispatch` lets a shop owner read exactly one
   * profile: their own. A join here returns nothing and fails SILENTLY — the
   * name is simply absent — so this pins the definer RPC that 0045 added for
   * it.
   */
  test('the rider name comes from the definer RPC, not a join', () => {
    assert.match(
      queries,
      /rpc\('event_actor_names'/,
      'the actor RPC is gone — a shop cannot read profiles, so names vanish silently',
    )
  })

  /** It keys on the event: orders.rider_id is whoever holds the parcel NOW. */
  test('and it is asked about events, not orders', () => {
    assert.match(queries, /p_event_ids: data\.map\(\(r\) => Number\(r\.id\)\)/)
  })

  test('the feed carries the township and the destination', () => {
    const sel = queries.slice(queries.indexOf('getShopNotifications'), queries.indexOf('ShopDeliveryDetail'))
    for (const field of ['dropoff_address', 'service_areas:dropoff_area_id']) {
      assert.ok(sel.includes(field), `${field} is missing — the batch list loses its destinations`)
    }
  })

  /** "Delivered" told a shop that something happened to something. */
  test('a single delivery is titled by who it went to', () => {
    assert.match(
      row,
      /group\.rows\[0\]!\.customerName, group\.rows\[0\]!\.township/,
      'the delivery headline is generic again',
    )
  })
})

describe('tapping a line opens it in place', () => {
  /**
   * Nothing navigates: the modal fetches through a server action and the feed
   * stays put, so a shop checking four deliveries does not lose its place four
   * times. A button rather than a link is what encodes that.
   */
  test('the opener is a button, not a link', () => {
    const slice = row.slice(row.indexOf('sn.viewDetail') - 400, row.indexOf('sn.viewDetail'))
    assert.match(slice, /<button/, 'the detail opener navigates again')
  })

  /**
   * `needsDecision` rows already carry a link. A row that is itself a control
   * cannot hold another without nesting interactive elements — the rule
   * JobCard is written on.
   */
  test('a row is never both a link and a button', () => {
    assert.match(
      row,
      /needsDecision\(group\.kind\) \? \([\s\S]{0,600}?\) : openable && onOpen \? \(/,
      'the decision link and the detail button are no longer mutually exclusive',
    )
  })

  /**
   * `groupEvents` keys on the exact transaction timestamp, so a batch group
   * ALREADY holds every row of the handover. Fetching again would be a round
   * trip to redisplay what is in memory.
   */
  test('the batch modal fetches nothing', () => {
    const body = detail.slice(detail.indexOf('function BatchBody'))
    assert.ok(!/await |\.then\(|use[A-Z]\w*Effect/.test(body), 'the batch view started fetching')
  })

  /** The proof is why a shop opens this during a dispute. */
  test('the proof photo enlarges', () => {
    assert.match(detail, /onClick=\{onZoom\}/, 'the proof is no longer tappable')
    assert.match(detail, /max-h-\[70vh\]/, 'the enlarged view is gone')
  })

  test('opening a row marks the feed read', () => {
    assert.match(actions, /markNoticesSeen\(\)/, 'opening a notification no longer clears the badge')
  })

  /**
   * getShopOrderDetail fires seven round trips for a page that shows all of
   * them. This modal answers a smaller question and should stay cheap — the
   * same reasoning ORDER_LABEL_COLUMNS is written on.
   */
  test('the delivery modal does not drag in the full order page query', () => {
    assert.ok(
      !/getShopOrderDetail/.test(actions),
      'the modal now pays for the rider card, two attempt RPCs and app_settings',
    )
  })
})
