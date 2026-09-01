import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/auth/guards'
import { getCodPositions, getLedger, getShopPositions } from '@/lib/admin/queries'
import { parseDayParam, yangonToday } from '@/lib/admin/day'
import { LEDGER_KINDS } from '@/lib/admin/ledger'
import { PageHeader } from '@/components/admin/kpi'
import { CodExplorer, type ExplorerView } from '@/components/admin/cod-explorer'
import type { LedgerKind } from '@/types/domain'

export const metadata: Metadata = { title: 'COD audit · Super Admin' }
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The COD audit explorer.
 *
 * Lives at /admin/audit rather than under /admin/super because the money views
 * are read-mostly, but it is still `requireAdmin` — a dispatcher has no business
 * in the fleet's cash position, and the adjustment form on the ledger tab writes
 * to the book of record.
 */
export default async function CodAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string
    rider?: string
    kind?: string
    settled?: string
    from?: string
    to?: string
  }>
}) {
  await requireAdmin()
  const sp = await searchParams

  const view: ExplorerView =
    sp.view === 'shops' ? 'shops' : sp.view === 'ledger' ? 'ledger' : 'riders'

  // Anything unrecognised is dropped rather than passed through — an invalid
  // enum reaches PostgREST as a 22P02 and blanks the whole page.
  const rider = sp.rider && UUID.test(sp.rider) ? sp.rider : ''
  const kind = LEDGER_KINDS.includes(sp.kind as LedgerKind) ? (sp.kind as LedgerKind) : undefined
  const settled = sp.settled === 'open' || sp.settled === 'settled' ? sp.settled : undefined

  const today = yangonToday()
  const to = parseDayParam(sp.to, today)
  const from = parseDayParam(sp.from, shiftDays(to, -30))

  // A rider drilldown lands on the ledger tab, so `rider` alone should focus it.
  const [positions, shops, ledger] = await Promise.all([
    getCodPositions(),
    view === 'shops' ? getShopPositions(from, to) : Promise.resolve([]),
    view === 'ledger'
      ? getLedger({ riderId: rider || undefined, kind, settled, limit: 200 })
      : Promise.resolve([]),
  ])

  return (
    <div className="space-y-4">
      <PageHeader
        title="COD audit explorer"
        description="Uncollected versus settled cash, across every rider and every shop. The rider ledger is append-only and is the book of record."
      />
      <CodExplorer
        view={view}
        positions={positions}
        shops={shops}
        ledger={ledger}
        filters={{ rider, kind: kind ?? '', settled: settled ?? '', from, to }}
      />
    </div>
  )
}
