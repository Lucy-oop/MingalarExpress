import type { Metadata } from 'next'
import { requireDispatch } from '@/lib/auth/guards'
import { getPlanningBoard } from '@/lib/routes/queries'
import { RouteBoard } from '@/components/routes/route-board'
import { Alert } from '@/components/ui/alert'

export const metadata: Metadata = { title: 'Route planning' }

/**
 * The office's home. Signing in lands here, because planning the day's runs is
 * what the office opens the app to do -- /admin had no index page at all until
 * this moved here from /admin/dispatcher.
 *
 * Always fresh. A cached planning board is a double-loading generator: two
 * tabs, or two people, acting on a stale manifest load the same parcel twice.
 * That was true when two dispatchers shared the board and is still true of one
 * person with the board open on a laptop and a phone -- the same reason the
 * offer-era dispatch queue was never cached.
 */
export const dynamic = 'force-dynamic'

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  await requireDispatch()
  const { date } = await searchParams

  let board
  try {
    // A bad ?date= falls through to today rather than erroring: the board is the
    // room's live work surface and must not be takeable down by a URL.
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined
    board = await getPlanningBoard(day)
  } catch (error) {
    return (
      <Alert tone="error" title="Planning board unavailable">
        {error instanceof Error ? error.message : 'Unknown error'}
      </Alert>
    )
  }

  return <RouteBoard board={board} />
}
