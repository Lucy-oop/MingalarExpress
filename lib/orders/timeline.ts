import { ORDER_CHECKPOINTS, type OrderStatus } from '@/types/domain'

/**
 * What a parcel's checkpoint trail actually says.
 *
 * Pure and unit-tested, because this is the thing a shop owner reads when
 * something has gone wrong, and getting it wrong costs trust rather than
 * correctness.
 *
 * TWO BUGS THIS EXISTS TO FIX.
 *
 * 1. A FAILED PARCEL SHOWED NO CONTEXT. `Failed` with `Picked up` greyed out
 *    reads as "we lost your parcel at the hub", and a shop owner has no way to
 *    tell that apart from "the rider could not collect it". Both are real —
 *    `assigned -> failed` is a legal transition and means the rider reached the
 *    shop and came away empty-handed — so the fix is to SAY WHICH, not to tick
 *    `Picked up` on a pickup that never happened. Claiming a rider has custody
 *    of goods still sitting on the shop's shelf is the worse error of the two,
 *    and the one that matters in a dispute.
 *
 * 2. A RETRIED PARCEL SHOWED THE WRONG DATES. The old timeline took the FIRST
 *    event of each status, so a parcel on its third attempt displayed attempt
 *    one's timestamps — a rider who collected it an hour ago appeared to have
 *    had it for three days. The trail is not one journey; it is one per attempt,
 *    and only the current one belongs on a four-step line.
 */

export type TimelineEvent = { status: OrderStatus; at: string }

export type TimelineStep = {
  status: OrderStatus
  at: string | null
  done: boolean
}

export type TimelineModel = {
  /** The four happy-path checkpoints, for the attempt currently in progress. */
  steps: TimelineStep[]
  /** `failed`, `cancelled` or `returned` — never part of the sequence. */
  terminal: { status: OrderStatus; at: string | null } | null
  /** 1-based: the attempt the steps above describe. */
  attempt: number
  /**
   * Did the parcel actually leave the shop on this attempt?
   *
   * The whole point of the model. False + `failed` means it never went
   * anywhere, which is reassuring news badly in need of being said out loud.
   */
  collected: boolean
}

/**
 * Where the current attempt begins.
 *
 * Every re-queue — `close_trip`'s auto-retry and the shop's own "try again" —
 * writes a transition INTO `pending`, so the last of those (index 0 being the
 * order's creation, not a retry) starts the attempt on screen.
 */
function attemptStart(events: TimelineEvent[]): number {
  for (let i = events.length - 1; i > 0; i -= 1) {
    if (events[i]!.status === 'pending') return i
  }
  return 0
}

export function buildTimeline(
  current: OrderStatus,
  events: TimelineEvent[] = [],
): TimelineModel {
  const start = attemptStart(events)
  const attemptEvents = events.slice(start)
  // Retries counted from the trail, so this agrees with order_attempt_count()
  // without a second round trip.
  const attempt = events.slice(0, start).filter((e) => e.status === 'pending').length + 1

  // The FIRST occurrence within this attempt.
  //
  // Not the last, and the difference is visible on a real order. A returned
  // parcel's trail is `pending, assigned, picked_up, failed, assigned, returned`
  // — the second `assigned` is the return leg being given to a rider, hours
  // AFTER the pickup. Taking the last occurrence printed "assigned 04:10" above
  // "picked up 13:29 the previous day", a timeline running backwards.
  //
  // Taking the first is safe precisely because `attemptEvents` is already
  // sliced to the current attempt: the retry bug this model exists to fix comes
  // from the slicing, not from which end of the list is read.
  const stampFor = (s: OrderStatus): string | null =>
    attemptEvents.find((e) => e.status === s)?.at ?? null

  const currentIndex = ORDER_CHECKPOINTS.indexOf(current)

  const steps: TimelineStep[] = ORDER_CHECKPOINTS.map((status, i) => {
    const at = stampFor(status)
    return {
      status,
      at,
      // A checkpoint is done if it HAPPENED. The index fallback only covers a
      // parcel whose current status is itself a checkpoint — it must never be
      // allowed to tick a step the trail does not support, which is exactly how
      // a fabricated pickup would get on screen.
      done: at !== null || (currentIndex >= 0 && i < currentIndex),
    }
  })

  const isTerminal = current === 'failed' || current === 'cancelled' || current === 'returned'

  return {
    steps,
    terminal: isTerminal ? { status: current, at: stampFor(current) } : null,
    attempt,
    collected: stampFor('picked_up') !== null,
  }
}

/**
 * The headline for a terminal step, and the reassurance underneath it.
 *
 * "Failed" alone invites the worst interpretation, and for a delivery business
 * the worst interpretation is the one that loses the shop.
 *
 * TWO AUDIENCES, DELIBERATELY DIFFERENT WORDS. The same component renders on the
 * shop's parcel page and on the PUBLIC tracking page a customer opens from a
 * link. Custody detail — "it is still at your shop", "back at the hub" — is the
 * shop's business and is exactly what a shop needs; a customer reading "your
 * shop" is being told about a shop that is not theirs, and being told the shop
 * failed to hand the parcel over is not the platform's news to break.
 *
 * So the customer gets the truth, minus the attribution.
 */
export type TimelineAudience = 'shop' | 'customer'

export function describeTerminal(
  status: OrderStatus,
  collected: boolean,
  audience: TimelineAudience = 'shop',
): { title: string; detail: string | null } {
  if (status === 'cancelled') {
    return { title: 'Cancelled', detail: null }
  }

  if (audience === 'customer') {
    if (status === 'returned') {
      return { title: 'Returned to the sender', detail: null }
    }
    // No mention of who held it up, and no attempt count: a customer does not
    // need to know it is the shop's third try.
    return {
      title: 'Not delivered yet',
      detail: 'We could not deliver this yet. We will try again.',
    }
  }

  if (status === 'returned') {
    return { title: 'Returned to your shop', detail: 'Signed for on delivery back to you.' }
  }
  return collected
    ? {
        title: 'Delivery attempt failed',
        detail: 'Your parcel is safe with us and back at the hub.',
      }
    : {
        title: 'Could not collect',
        detail: 'The rider could not collect this parcel — it is still at your shop.',
      }
}
