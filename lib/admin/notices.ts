/**
 * What the office needs to know about, for the bell in the admin header.
 *
 * WHY THIS EXISTS. A merchant can register and be trading in the same minute, so
 * nothing forces the office to find out. The notice on `/admin/super` is a
 * WORKLIST -- `getNewShopNotices` filters `approved_at is null` -- which means
 * reviewing a shop erases the record that it ever registered. That is right for
 * a queue and wrong for a feed, so the two are separate on purpose.
 *
 * DERIVED, NOT STORED. A notice is not a fact in its own right: "San Pya Mini
 * Mart registered" is `shops.created_at`, already recorded and already readable
 * by the office through `shops_read_dispatch`. A notices table would be a second
 * copy kept in step by a trigger, free to drift, and able to claim a shop
 * registered after the shop row was gone. `0016` is the cautionary tale --
 * `notification_outbox` was a real queue with a worker and retries, and it was
 * deleted six days later because the operation did not want it. A queue earns
 * its keep when something must be DELIVERED. Nothing here is delivered; it is
 * read.
 *
 * The one thing that cannot be derived is "have I seen it", because that is
 * about the reader rather than the shop. `profiles.notices_seen_at` (0035) is
 * therefore the only stored part.
 *
 * NO I/O IN THIS FILE, so the copy and the arithmetic are testable without a
 * database.
 */

import { isNewSince, unseenCount } from '@/lib/orders/notifications'

/**
 * One line in the feed.
 *
 * `kind` is a single-member union today and that is deliberate: rider approvals
 * and the KPay receipt queue are the obvious next two, and having the tag from
 * the start means they arrive without the component changing shape.
 */
export type OfficeNotice = {
  /** Stable across refreshes, so React keys and any future dedupe hold. */
  id: string
  kind: 'shop_registered'
  /** ISO. What `unseenCount` compares against the reader's marker. */
  at: string
  title: string
  /** A second line, or null when there is nothing worth adding. */
  detail: string | null
  /** Where clicking it goes. */
  href: string
}

/**
 * The shop fields a notice is built from. A structural subset of
 * `NewShopNotice`, so the query type can carry extra fields without this
 * knowing.
 *
 * `name` is `string | null` only because `NewShopNotice` declares it that way.
 * The column is `text not null check (length(trim(name)) > 0)`, so the fallback
 * below is unreachable in practice — but this renders in the LAYOUT of every
 * admin page, and a feed is not the place to discover that a type was optimistic.
 */
export type ShopRegistration = {
  shopId: string
  name: string | null
  ownerName: string
  goodsType: string | null
  createdAt: string
}

/**
 * A registration, as the office should read it.
 *
 * The title names the SHOP, because that is what the office will be looking for
 * in the list five minutes later — not "a new shop registered", which is true of
 * every row and therefore tells them nothing.
 *
 * `href` is a deep link that already works: `ShopManager` reads `?shop=` on
 * mount, opens `ShopDetailModal` on that row, then `router.replace`s the query
 * away so a refresh does not reopen it (8498c1e).
 */
export function shopRegistrationNotice(shop: ShopRegistration): OfficeNotice {
  return {
    id: `shop_registered:${shop.shopId}`,
    kind: 'shop_registered',
    at: shop.createdAt,
    title: `${shop.name ?? 'A new shop'} has registered`,
    // What they sell is the single most useful thing for deciding whether to
    // unlock COD, which is the only decision this notice leads to.
    detail: shop.goodsType ? `${shop.ownerName} · ${shop.goodsType}` : shop.ownerName,
    href: `/admin/shops?shop=${shop.shopId}`,
  }
}

/**
 * The feed, newest first.
 *
 * Sorted here rather than relying on the query, because a second source will
 * arrive with its own ordering and merging two already-sorted lists by hand is
 * the kind of thing that silently half-works.
 */
export function officeNotices(shops: readonly ShopRegistration[]): OfficeNotice[] {
  return shops
    .map(shopRegistrationNotice)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/**
 * How many the reader has not seen.
 *
 * Re-exported rather than reimplemented: `unseenCount` in
 * `lib/orders/notifications.ts` is the same arithmetic with the same two awkward
 * cases (never looked, unparseable marker), and a second copy would be a second
 * place to get them wrong.
 */
export { unseenCount, isNewSince }
