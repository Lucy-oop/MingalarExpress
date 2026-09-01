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
