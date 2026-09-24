/**
 * The office's words for the route model: ways, pickup ways, delivery ways.
 *
 * PURE, so the board and its tests agree on one answer to each question.
 */

/**
 * The short label for a way: ROUTE_A -> "Way 1", ROUTE_LOCAL -> "Local Way".
 *
 * `routes.code` stays ROUTE_* because pricing constants, tests and every seed
 * key on it (0049). This is the only place that turns it into words, so the
 * board, the parcel panel and the pricing page cannot drift apart again the
 * way three copies of `code.replace('ROUTE_', 'Route ')` could.
 */
export function wayLabel(code: string): string {
  const letter = /^ROUTE_([A-Z])$/.exec(code)
  if (letter) return `Way ${letter[1]!.charCodeAt(0) - 64}`
  if (code === 'ROUTE_LOCAL') return 'Local Way'
  const rest = code.replace(/^ROUTE_/, '')
  return rest
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

export type TripKind = 'pickup' | 'delivery'

/** Statuses a collected pickup can be in -- mirrors receive_trip_parcels. */
const COLLECTED = new Set(['picked_up', 'delivered'])

/**
 * Whether one parcel on a run can be ticked as "came off the bike".
 *
 * A pickup the rider has not collected yet (`assigned`) or failed to collect
 * is listed but cannot be received: it is still at the shop.
 */
export function isReceivable(p: { leg: string; status: string }): boolean {
  return p.leg === 'pickup' && COLLECTED.has(p.status)
}
