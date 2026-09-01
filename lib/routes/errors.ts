/**
 * Maps the trip RPCs' raise conditions to messages a dispatcher can act on.
 *
 * Outside `actions.ts` because a `'use server'` module may only export async
 * functions, so a mapper defined there could never be unit-tested.
 *
 * The important one is `trip_below_minimum`. It is not a failure — it is the
 * system asking for a reason, and the board turns it into a modal rather than an
 * error. Flattening it into "something went wrong" would leave a dispatcher
 * unable to send a legitimate short run at all, and the first thing they would
 * do is stop trusting the board.
 */

export type TripErrorKind =
  | 'below_minimum'
  | 'reason_too_short'
  | 'no_rider'
  | 'rider_busy'
  | 'empty'
  | 'over_cod_cap'
  | 'over_parcel_cap'
  | 'not_loadable'
  | 'orders_not_loadable'
  | 'open_orders'
  | 'wrong_state'
  | 'not_found'
  | 'forbidden'
  | 'unknown'

export type ExplainedTripError = {
  kind: TripErrorKind
  message: string
  /** True when re-reading the board and repeating the same action could work. */
  retry: boolean
}

const MAP: Array<{ match: RegExp; value: ExplainedTripError }> = [
  {
    // Checked FIRST: the hint text on several other conditions also mentions
    // parcels, and this one changes what the UI does rather than just what it
    // says.
    match: /trip_below_minimum/i,
    value: {
      kind: 'below_minimum',
      message: 'This run is under the minimum parcel count. Give a reason to send it out anyway.',
      retry: false,
    },
  },
  {
    match: /override_reason_too_short/i,
    value: {
      kind: 'reason_too_short',
      message: 'The override reason needs at least 10 characters — say why this run is going short.',
      retry: false,
    },
  },
  {
    match: /trip_has_no_rider/i,
    value: {
      kind: 'no_rider',
      message: 'Put a rider on this run before dispatching it.',
      retry: false,
    },
  },
  {
    match: /rider_already_on_trip/i,
    value: {
      kind: 'rider_busy',
      message: 'That rider is already out on another run. Bring that one back first.',
      retry: true,
    },
  },
  {
    match: /trip_empty/i,
    value: { kind: 'empty', message: 'Load at least one parcel before departing.', retry: false },
  },
  {
    match: /trip_over_cod_cap/i,
    value: {
      kind: 'over_cod_cap',
      message:
        'This load exceeds the route’s COD ceiling. Split it across two runs, or raise the ceiling in route settings.',
      retry: false,
    },
  },
  {
    match: /trip_over_parcel_cap/i,
    value: {
      kind: 'over_parcel_cap',
      message: 'This load exceeds the route’s parcel ceiling. Move some parcels to another run.',
      retry: false,
    },
  },
  {
    match: /orders_not_loadable|order_on_trip/i,
    value: {
      kind: 'orders_not_loadable',
      message:
        'At least one of those parcels is already on a run or has moved on. The board has been refreshed.',
      retry: true,
    },
  },
  {
    match: /trip_not_loadable/i,
    value: {
      kind: 'not_loadable',
      message: 'This run has already left. Loading is only possible before departure.',
      retry: false,
    },
  },
  {
    match: /trip_has_open_orders/i,
    value: {
      kind: 'open_orders',
      message:
        'Every parcel must be delivered, failed or cancelled before the run can be closed and paid.',
      retry: false,
    },
  },
  {
    match: /trip_orders_not_ready/i,
    value: {
      kind: 'open_orders',
      message: 'Some parcels on this run are not ready to go. Refresh the board and check the list.',
      retry: true,
    },
  },
  {
    match:
      /trip_not_departable|trip_not_returnable|trip_not_closable|trip_already_closed|trip_rider_locked|trip_closed|route_inactive/i,
    value: {
      kind: 'wrong_state',
      message: 'This run has already moved on. Refresh the board and try again.',
      retry: false,
    },
  },
  {
    match: /trip_not_found|route_not_found|rider_not_found|order_not_found/i,
    value: { kind: 'not_found', message: 'That no longer exists. Refresh the board.', retry: false },
  },
  {
    // Last: `forbidden` is the generic 42501 text and the conditions above are
    // more useful when both could match.
    match: /forbidden|42501|permission denied|row-level security/i,
    value: {
      kind: 'forbidden',
      message: 'You do not have permission to do that.',
      retry: false,
    },
  },
]

export function explainTripError(raw: string | null | undefined): ExplainedTripError {
  const text = raw ?? ''
  for (const { match, value } of MAP) {
    if (match.test(text)) return value
  }
  return {
    kind: 'unknown',
    message: 'Could not complete that. Refresh the board and try again.',
    retry: true,
  }
}

/** The override the depart modal collects. Mirrors the SQL check in 0008. */
export const OVERRIDE_REASON_MIN_LENGTH = 10

export function validateOverrideReason(reason: string): string | null {
  const trimmed = reason.trim()
  if (trimmed.length === 0) return 'A reason is required to dispatch an under-minimum run.'
  if (trimmed.length < OVERRIDE_REASON_MIN_LENGTH) {
    return `Give at least ${OVERRIDE_REASON_MIN_LENGTH} characters — ${trimmed.length} so far.`
  }
  return null
}
