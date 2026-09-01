/**
 * Maps the dispatch RPCs' raise conditions to messages a dispatcher can act on.
 *
 * This lives outside `actions.ts` because a `'use server'` module may only
 * export async functions — so a mapper defined there can never be unit-tested.
 * It is the most important error surface in the product: `assign_order` is
 * DESIGNED to lose a race loudly, and if the UI flattens that into "something
 * went wrong" the dispatcher retries and ends up believing they assigned a rider
 * who is actually carrying someone else's parcel.
 */

export type DispatchErrorKind =
  | 'lost_race'
  | 'rider_unavailable'
  | 'order_not_found'
  | 'rider_not_found'
  | 'illegal_transition'
  | 'forbidden'
  | 'unknown'

export type Explained = {
  kind: DispatchErrorKind
  message: string
  /** Whether re-fetching the rider list and trying again could plausibly work. */
  retry: boolean
}

const MAP: Array<{ match: RegExp; value: Explained }> = [
  {
    // `order_not_assignable: assigned` — someone else won the lock.
    match: /order_not_assignable/i,
    value: {
      kind: 'lost_race',
      message:
        'Another dispatcher just took this order. The board has been refreshed — pick a different order.',
      retry: false,
    },
  },
  {
    match: /rider_unavailable/i,
    value: {
      kind: 'rider_unavailable',
      message:
        'That rider became unavailable a moment ago — went offline, hit their parcel limit, or took another job. Choose another rider.',
      retry: true,
    },
  },
  {
    match: /order_not_found/i,
    value: { kind: 'order_not_found', message: 'That order no longer exists.', retry: false },
  },
  {
    match: /rider_not_found/i,
    value: {
      kind: 'rider_not_found',
      message: 'That rider profile no longer exists.',
      retry: false,
    },
  },
  {
    match: /illegal_transition/i,
    value: {
      kind: 'illegal_transition',
      message: 'The order has already moved on. Refresh the board and try again.',
      retry: false,
    },
  },
  {
    // Checked last: `forbidden` is the generic 42501 text, and the specific
    // conditions above are more useful when both could match.
    match: /forbidden|42501|permission denied|row-level security/i,
    value: {
      kind: 'forbidden',
      message: 'You do not have permission to do that.',
      retry: false,
    },
  },
]

export function explainDispatchError(raw: string | null | undefined): Explained {
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
