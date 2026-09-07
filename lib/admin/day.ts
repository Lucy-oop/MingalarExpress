/**
 * Moved to `lib/time/day.ts`.
 *
 * The rider's earnings page needs these helpers too, and a rider screen
 * importing from `lib/admin/` reads like a mistake even when it works. Five
 * files import this path, so it re-exports rather than making them all churn —
 * new code should import `@/lib/time/day` directly.
 */
export {
  isoAddDays,
  isoDaysAgo,
  nextDay,
  parseDayParam,
  yangonToday,
} from '@/lib/time/day'
