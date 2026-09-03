/**
 * How long a parcel has been sitting, and when that becomes a problem.
 *
 * Pure, so the threshold and the wording are testable without a database or a
 * browser. Used by the "Waiting on a shop" worklist, where the whole value of
 * the list is knowing which row has been ignored longest.
 *
 * WHERE THE FAILURE TIME COMES FROM. `orders.closed_at`, not a new column and
 * not a query into the event trail: the status machine stamps `closed_at = now()`
 * on entering `failed`, and clears it again on the way back to `pending`. So for
 * a parcel sitting at `failed`, `closed_at` IS the moment it last failed — and
 * because it is a column on `orders`, Postgres can ORDER BY it, which a
 * derived-from-events figure could not do without breaking pagination.
 */

/** Two days is the point at which the office has clearly not got to it. */
export const STALE_AFTER_HOURS = 48

export function hoursWaiting(since: string | null, now: Date = new Date()): number | null {
  if (!since) return null
  const then = new Date(since).getTime()
  if (Number.isNaN(then)) return null
  // Clamp at zero: a row stamped a second into the future by clock skew should
  // read as "just now", not as a negative age.
  return Math.max(0, (now.getTime() - then) / 3_600_000)
}

export function isStale(since: string | null, now: Date = new Date()): boolean {
  const h = hoursWaiting(since, now)
  return h !== null && h >= STALE_AFTER_HOURS
}

/**
 * A short age for a table cell: "2h", "3d". Deliberately coarse — a dispatcher
 * scanning a queue needs the order of magnitude, and "1 day 4 hours" is three
 * times the width for no extra decision.
 */
export function formatAge(since: string | null, now: Date = new Date()): string {
  const h = hoursWaiting(since, now)
  if (h === null) return '—'
  if (h < 1) return 'just now'
  if (h < 24) return `${Math.floor(h)}h`
  return `${Math.floor(h / 24)}d`
}
