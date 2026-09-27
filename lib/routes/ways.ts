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

/** A pickup the rider was sent for and has not collected (0051). */
export function isUncollected(p: { leg: string; status: string }): boolean {
  return p.leg === 'pickup' && (p.status === 'pending' || p.status === 'assigned')
}

export type CloseBlocker =
  | { kind: 'open_deliveries'; count: number }
  | { kind: 'uncollected'; count: number }
  | { kind: 'unreceived'; count: number }

/**
 * Why Close & pay cannot run yet, or null when it can.
 *
 * MIRRORS close_trip's refusals, in its order, so the button is disabled for
 * exactly the runs the database would refuse -- the office is told on the card
 * rather than by an error after pressing:
 *
 *   1. deliveries or returns still out           (trip_has_open_orders)
 *   2. pickups never collected, not resolved     (trip_has_uncollected_pickups, 0051)
 *   3. collected pickups not ticked off          (trip_has_unreceived_pickups, 0050)
 *
 * (close_trip checks 3 before 1 internally; the order here is the order the
 * office would fix them in, and any one of them is enough to refuse.)
 */
export function closeBlocker(
  parcels: ReadonlyArray<{ leg: string; status: string }>,
): CloseBlocker | null {
  const open = parcels.filter(
    (p) =>
      (p.leg === 'delivery' || p.leg === 'return') &&
      (p.status === 'pending' || p.status === 'assigned' || p.status === 'picked_up'),
  ).length
  if (open > 0) return { kind: 'open_deliveries', count: open }
  const uncollected = parcels.filter(isUncollected).length
  if (uncollected > 0) return { kind: 'uncollected', count: uncollected }
  const unreceived = parcels.filter(isReceivable).length
  if (unreceived > 0) return { kind: 'unreceived', count: unreceived }
  return null
}
