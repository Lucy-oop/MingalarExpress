import type { Metadata } from 'next'
import { getCodPositions, getSettlements } from '@/lib/admin/queries'
import { parseDayParam, yangonToday } from '@/lib/admin/day'
import { PageHeader } from '@/components/admin/kpi'
import { SettlementRunner } from '@/components/admin/settlement-runner'

export const metadata: Metadata = { title: 'Settlements · Super Admin' }
export const dynamic = 'force-dynamic'

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const { date: raw } = await searchParams
  const today = yangonToday()
  const date = parseDayParam(raw, today)

  const [dayRows, recent, positions] = await Promise.all([
    getSettlements(date),
    getSettlements(),
    getCodPositions(),
  ])

  // The focused day is rendered in full above; the history table below should
  // not repeat it.
  const history = recent.filter((s) => s.period_date !== date).slice(0, 40)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settlement engine"
        description="Draft a day, collect the cash riders are holding, then approve and pay out. A rider's balance clears the moment build_settlement claims their ledger lines — approval and payment track the physical cash after that."
      />
      <SettlementRunner
        date={date}
        today={today}
        settlements={dayRows}
        recent={history}
        positions={positions}
      />
    </div>
  )
}
