/**
 * The business day is Asia/Yangon (UTC+06:30), matching SQL `mm_today()`.
 *
 * Deriving it from the server's clock in UTC would put the settlement screen on
 * the wrong day for six and a half hours out of every twenty-four — exactly the
 * window in which an evening's deliveries get settled.
 */
export function yangonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yangon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Accept a `?date=` only if it is a real ISO date; otherwise fall back to today. */
export function parseDayParam(raw: string | undefined, fallback: string): string {
  if (!raw || !ISO_DATE.test(raw)) return fallback
  const parsed = new Date(`${raw}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? fallback : raw
}

/**
 * `YYYY-MM-DD` shifted by whole days on the Yangon calendar.
 *
 * Parsed as UTC midnight deliberately: the strings here are calendar dates, not
 * instants, so arithmetic on them must not be affected by the server's timezone.
 * Anchoring at UTC keeps `isoDaysAgo(d, 1)` the previous calendar day everywhere.
 *
 * Lives here rather than beside the queries that use it because client
 * components need it too, and `lib/orders/queries.ts` pulls in `next/headers`.
 */
export function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const isoDaysAgo = (iso: string, days: number) => isoAddDays(iso, -days)
export const nextDay = (iso: string) => isoAddDays(iso, 1)
