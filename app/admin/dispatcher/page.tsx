import type { Metadata } from 'next'
import { requireDispatch } from '@/lib/auth/guards'
import { getPlanningBoard } from '@/lib/routes/queries'
import { RouteBoard } from '@/components/routes/route-board'
import { Alert } from '@/components/ui/alert'

export const metadata: Metadata = { title: 'Route planning' }

/**
 * Always fresh. Two dispatchers work this board at once, and a cached planning
 * board is a double-loading generator — the same reason the offer-era dispatch
 * queue was never cached.
 */
export const dynamic = 'force-dynamic'

export default async function DispatcherPage({
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
