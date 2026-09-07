/**
 * The business day is Asia/Yangon (UTC+06:30), matching SQL `mm_today()`.
 *
 * Deriving it from the server's clock in UTC would put the settlement screen on
 * the wrong day for six and a half hours out of every twenty-four — exactly the
 * window in which an evening's deliveries get settled.
 *
 * MOVED HERE FROM `lib/admin/day.ts`, which still re-exports every name so no
 * admin import changed. The rider's earnings page needs these too, and a rider
 * screen importing from `lib/admin/` reads like a mistake even when it works.
 * Client components need them as well, which is why this module pulls in
 * nothing server-only — `lib/orders/queries.ts` imports `next/headers`.
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
 */
export function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const isoDaysAgo = (iso: string, days: number) => isoAddDays(iso, -days)
export const nextDay = (iso: string) => isoAddDays(iso, 1)

// ---------------------------------------------------------------------------
// Grouping a list by the day it happened on
// ---------------------------------------------------------------------------

/**
 * Which Yangon calendar day a timestamp belongs to.
 *
 * NOT `iso.slice(0, 10)`, which is the obvious version and wrong by six and a
 * half hours: a parcel booked at 23:00 Yangon is stored as 16:30Z the same day,
 * but one booked at 01:00 Yangon is 18:30Z the day BEFORE. Slicing would file
 * every evening's work under yesterday.
 */
export function yangonDayKey(iso: string): string {
  return yangonToday(new Date(iso))
}

export type DayGroup<T> = { key: string; rows: T[] }

/**
 * Consecutive runs of the same day, in the order given.
 *
 * Deliberately NOT a sort or a Map: the caller has already ordered the rows the
 * way the user asked for, and re-grouping globally would silently reorder a
 * list sorted by something other than the date it is grouped on — which
 * `/admin/orders` does, sorting by three different columns depending on the
 * saved view. Runs preserve whatever order arrived.
 */
export function groupByDay<T>(rows: readonly T[], getDate: (row: T) => string): DayGroup<T>[] {
  const out: DayGroup<T>[] = []
  for (const row of rows) {
    const key = yangonDayKey(getDate(row))
    const last = out[out.length - 1]
    if (last && last.key === key) last.rows.push(row)
    else out.push({ key, rows: [row] })
  }
  return out
}

const MY_DIGITS = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉']
const MY_MONTHS = [
  'ဇန်',
  'ဖေ',
  'မာ',
  'ပြီ',
  'မေ',
  'ဇွန်',
  'ဇူ',
  'ဂု',
  'စက်',
  'အောက်',
  'နို',
  'ဒီ',
]

/**
 * `Today` / `Yesterday` / `6 Sept 2026`, in the reader's language.
 *
 * THE YEAR IS DELIBERATE. `formatDateTimeYangon` renders `06 Sept, 14:30` with
 * no year at all, so every table in the app shows a parcel from last September
 * identically to one from this September. The day header is where that gets
 * fixed, which is a reason to group beyond the scanning.
 *
 * BURMESE DIGITS HERE, and this is the first use outside a count. `localeNumber`
 * deliberately keeps them away from money and order codes, because those get
 * cross-checked against paperwork and a dispute is not the moment to be
 * transliterating numerals. A date is neither: nobody reads a section header
 * back to the office over the phone.
 */
export function formatDayHeader(key: string, today: string, locale: 'en' | 'my'): string {
  if (key === today) return locale === 'my' ? 'ဒီနေ့' : 'Today'
  if (key === isoDaysAgo(today, 1)) return locale === 'my' ? 'မနေ့က' : 'Yesterday'

  const [y, m, d] = key.split('-')
  const day = String(Number(d))
  const monthIndex = Number(m) - 1

  if (locale === 'my') {
    const burmese = (s: string) => s.replace(/\d/g, (c) => MY_DIGITS[Number(c)]!)
    return `${burmese(day)} ${MY_MONTHS[monthIndex] ?? m} ${burmese(y!)}`
  }

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${key}T00:00:00Z`))
}
