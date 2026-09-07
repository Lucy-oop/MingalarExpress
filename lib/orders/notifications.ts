/**
 * What has happened to a shop's parcels, newest first.
 *
 * DERIVED, WITH NO TABLE OF ITS OWN. This project built an SMS outbox in 0014
 * and removed it in 0016 -- `docs/ARCHITECTURE.md` records automated messaging
 * as a non-goal, because the office rings the shop instead. What was removed
 * was the *delivery mechanism*; the events themselves were always there.
 *
 * `order_status_events` is written by `tg_orders_audit` inside the same
 * transaction as the status change, is append-only, and is already readable by
 * a shop through the `ose_read` policy. So this feed cannot drift from what
 * actually happened, because it IS what actually happened. No outbox, no
 * worker, no second write path, no migration.
 *
 * WHAT A SHOP IS TOLD, and nothing else:
 *
 *   -> picked_up          collected from you
 *   assigned  -> failed   the rider reached you and came away empty
 *   picked_up -> failed   out for delivery and could not be handed over
 *   -> returned           back with you
 *   -> delivered          done
 *
 * The two failure kinds are not invented for this screen: 0018 already counts
 * them separately for the two attempt ceilings, so "we could not collect it"
 * and "the customer was not there" are separable facts about the same status.
 *
 * `assigned` is deliberately absent. A parcel being put on a run is dispatch
 * moving work around and there is nothing for the shop to do about it; a feed
 * that reports it becomes a feed nobody reads.
 */

export type NotificationKind =
  | 'collected'
  | 'not_collected'
  | 'delivery_failed'
  | 'returned'
  | 'delivered'

/** One row as it comes back from `order_status_events`, joined to its order. */
export type EventRow = {
  id: number
  fromStatus: string | null
  toStatus: string
  createdAt: string
  orderId: string
  code: string
  customerName: string
  /**
   * The reason recorded AT THIS TRANSITION, from `order_status_events.note`
   * — which `tg_orders_audit` fills with `coalesce(app.event_note,
   * fail_reason, cancel_reason)`.
   *
   * Deliberately not `orders.fail_reason`, which holds only the LATEST reason:
   * a parcel that failed twice would show its second reason against its first
   * event, quietly rewriting history on the shop's own screen.
   */
  failReason: string | null
}

export type NotificationGroup = {
  /** Stable across renders: the kind plus the instant it happened. */
  key: string
  kind: NotificationKind
  at: string
  rows: EventRow[]
  /** Set only when every parcel in the group carries the same reason. */
  reason: string | null
}

/**
 * `null` for a transition a shop is not told about, so the caller can filter
 * without repeating the rules.
 */
export function classifyEvent(fromStatus: string | null, toStatus: string): NotificationKind | null {
  if (toStatus === 'picked_up') return 'collected'
  if (toStatus === 'returned') return 'returned'
  if (toStatus === 'delivered') return 'delivered'
  if (toStatus === 'failed') {
    // The rider reached the shop and came away empty — the parcel never left.
    if (fromStatus === 'assigned') return 'not_collected'
    return 'delivery_failed'
  }
  return null
}

/**
 * Collapse an armful into one line.
 *
 * THE GROUPING KEY IS EXACT, not a time window. `order_status_events.created_at`
 * defaults to `now()`, which in Postgres is TRANSACTION time — so the ten rows
 * written by one `advance_orders` call share a byte-identical timestamp. Ten
 * parcels collected in one tap are therefore one group by construction, with no
 * tolerance to tune and nothing to guess.
 *
 * Two separate taps a second apart stay two lines, which is correct: they were
 * two events, and a shop reading "10 parcels collected" wants that to mean one
 * handover.
 *
 * Input is expected newest-first; order is preserved.
 */
export function groupEvents(rows: readonly EventRow[]): NotificationGroup[] {
  const out: NotificationGroup[] = []
  const byKey = new Map<string, NotificationGroup>()

  for (const row of rows) {
    const kind = classifyEvent(row.fromStatus, row.toStatus)
    if (!kind) continue

    const key = `${kind}:${row.createdAt}`
    const existing = byKey.get(key)
    if (existing) {
      existing.rows.push(row)
      // A reason only survives while every parcel in the group agrees. Showing
      // one parcel's reason against ten would misattribute it.
      if (existing.reason !== row.failReason) existing.reason = null
      continue
    }

    const group: NotificationGroup = {
      key,
      kind,
      at: row.createdAt,
      rows: [row],
      reason: row.failReason,
    }
    byKey.set(key, group)
    out.push(group)
  }

  return out
}

/** Groups newer than the shop's last visit. `null` means they have never looked. */
export function unseenCount(groups: readonly NotificationGroup[], since: string | null): number {
  if (!since) return groups.length
  const mark = Date.parse(since)
  if (Number.isNaN(mark)) return groups.length
  return groups.filter((g) => Date.parse(g.at) > mark).length
}
