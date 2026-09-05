/**
 * What to tell a shop when one of its parcels moves.
 *
 * `picked_up` MEANS TWO DIFFERENT THINGS and the shop needs to be told which.
 * On a `delivery` leg the rider has taken the parcel off the shelf AT THE HUB
 * and is on the way to the customer. On a `pickup` leg the rider is standing in
 * the shop and has just taken it off the counter. Same status, opposite ends of
 * the journey — "your parcel is on its way" would be wrong for one of them.
 *
 * A `return` leg reaching `picked_up` is the parcel starting its journey BACK,
 * which the shop already knows about (they asked for it) and which gets its own
 * message when it arrives. It is not announced here.
 *
 * Pure so the wording rules are testable without a socket.
 */

export type PickupKind = 'from_shop' | 'to_customer'

export type ParcelMoved = {
  code: string
  kind: PickupKind
}

/** The realtime payload shape we care about, from `postgres_changes` on orders. */
export type OrderRowLike = {
  status?: string | null
  trip_leg?: string | null
  code?: string | null
}

/**
 * True only on the EDGE into `picked_up`.
 *
 * `orders` carries `replica identity full`, so the payload's `old` record is
 * populated and the edge is detectable without a schema change. Without the
 * edge test, any later update to a picked-up parcel — a dispatcher adding a
 * note, `close_trip` detaching it — would re-announce a collection that
 * happened hours ago.
 */
export function isPickupEdge(
  previous: OrderRowLike | null | undefined,
  next: OrderRowLike | null | undefined,
): boolean {
  if (next?.status !== 'picked_up') return false
  return previous?.status !== 'picked_up'
}

/** Which side of the journey this collection is. Null means "do not announce". */
export function pickupKind(tripLeg: string | null | undefined): PickupKind | null {
  if (tripLeg === 'return') return null
  return tripLeg === 'pickup' ? 'from_shop' : 'to_customer'
}

export type AlertTally = { fromShop: number; toCustomer: number }

export const EMPTY_TALLY: AlertTally = { fromShop: 0, toCustomer: 0 }

export function tallyOf(moves: ParcelMoved[]): AlertTally {
  return moves.reduce<AlertTally>(
    (acc, m) => ({
      fromShop: acc.fromShop + (m.kind === 'from_shop' ? 1 : 0),
      toCustomer: acc.toCustomer + (m.kind === 'to_customer' ? 1 : 0),
    }),
    EMPTY_TALLY,
  )
}

export function tallyTotal(t: AlertTally): number {
  return t.fromShop + t.toCustomer
}

export function mergeTally(a: AlertTally, b: AlertTally): AlertTally {
  return { fromShop: a.fromShop + b.fromShop, toCustomer: a.toCustomer + b.toCustomer }
}

/**
 * Which message key the banner should use.
 *
 * A mixed batch — the rider collected two from the counter and also set off with
 * three from the hub — is reported as the plain count rather than inventing a
 * sentence that covers both. Two separate banners would be worse: they arrive in
 * the same second and one would cover the other.
 */
export type AlertMessage =
  | { key: 'shop.alert.collectedOne'; count: 1 }
  | { key: 'shop.alert.collectedMany'; count: number }
  | { key: 'shop.alert.onTheWayOne'; count: 1 }
  | { key: 'shop.alert.onTheWayMany'; count: number }
  | { key: 'shop.alert.movedMany'; count: number }

export function alertMessage(t: AlertTally): AlertMessage | null {
  const total = tallyTotal(t)
  if (total === 0) return null

  if (t.fromShop > 0 && t.toCustomer > 0) {
    return { key: 'shop.alert.movedMany', count: total }
  }
  if (t.fromShop > 0) {
    return t.fromShop === 1
      ? { key: 'shop.alert.collectedOne', count: 1 }
      : { key: 'shop.alert.collectedMany', count: t.fromShop }
  }
  return t.toCustomer === 1
    ? { key: 'shop.alert.onTheWayOne', count: 1 }
    : { key: 'shop.alert.onTheWayMany', count: t.toCustomer }
}
