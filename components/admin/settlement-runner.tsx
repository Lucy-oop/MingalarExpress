'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Banknote, CalendarDays, Play, Wallet } from 'lucide-react'
import {
  approveSettlement,
  buildDaySettlements,
  buildRiderSettlement,
  markSettlementPaid,
  type AdminResult,
} from '@/lib/admin/actions'
import type { CodPosition, SettlementRow } from '@/lib/admin/queries'
import { SettlementStatusBadge } from '@/components/admin/settlement-status'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Kpi } from '@/components/admin/kpi'
import { cn, formatMmk } from '@/lib/utils'

type Feedback = { tone: 'success' | 'error' | 'info'; message: string }

export function SettlementRunner({
  date,
  today,
  settlements,
  recent,
  positions,
}: {
  date: string
  today: string
  settlements: SettlementRow[]
  recent: SettlementRow[]
  positions: CodPosition[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const byRider = new Map(settlements.map((s) => [s.rider_id, s]))

  /**
   * Riders holding an unclaimed balance.
   *
   * Keyed on the open balance, not on "has no settlement yet": a rider whose day
   * is already drafted -- even approved or paid -- can go straight back out and
   * collect more COD, and that new cash is unclaimed too. Filtering them out
   * because a settlement row exists would hide live money.
   *
   * `build_settlement` sweeps stragglers from earlier days as well, so a
   * non-zero open balance is the whole signal.
   */
  const outstanding = positions
    .filter((p) => p.open_balance !== 0)
    .map((p) => {
      const existing = byRider.get(p.rider_id)
      return {
        position: p,
        existing,
        // build_settlement raises `settlement_locked` on an approved or paid
        // row, so offering the button would only produce an error.
        locked: existing?.status === 'approved' || existing?.status === 'paid',
      }
    })

  const totals = settlements.reduce(
    (acc, s) => ({
      gross: acc.gross + s.gross_cod,
      earnings: acc.earnings + s.rider_earnings,
      platform: acc.platform + s.platform_share,
      net: acc.net + s.net_due_platform,
      orders: acc.orders + s.order_count,
    }),
    { gross: 0, earnings: 0, platform: 0, net: 0, orders: 0 },
  )

  async function run(key: string, work: () => Promise<AdminResult>) {
    setBusy(key)
    setFeedback(null)
    try {
      const result = await work()
      setFeedback({ tone: result.ok ? 'success' : 'error', message: result.message })
      if (result.ok) startTransition(() => router.refresh())
    } catch {
      setFeedback({ tone: 'error', message: 'Network problem — nothing was saved. Try again.' })
    } finally {
      setBusy(null)
    }
  }

  function goToDate(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('date', next)
    router.push(`/admin/super/settlements?${params.toString()}`)
  }

  return (
    <div className="space-y-4">
      {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

      {/* ---------------------------------------------------------------- */}
      {/* Day selector + build                                              */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CalendarDays className="size-4" />
            Settlement day
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            A business day runs 00:00–24:00 <strong>Yangon time</strong>, not UTC. Building is
            idempotent — re-running a day re-claims anything new and recomputes the totals.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label htmlFor="period" className="text-sm font-medium">
              Period date
            </label>
            <Input
              id="period"
              type="date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && goToDate(e.target.value)}
              className="w-44"
            />
          </div>

          <Button
            disabled={busy !== null}
            onClick={() => run('build-day', () => buildDaySettlements(date))}
          >
            <Play />
            {busy === 'build-day' ? 'Building…' : 'Build settlements for this day'}
          </Button>

          {date !== today ? (
            <Button variant="ghost" onClick={() => goToDate(today)}>
              Jump to today
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Day totals                                                        */}
      {/* ---------------------------------------------------------------- */}
      {settlements.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label="Riders settled" value={settlements.length} hint={`${totals.orders} orders`} />
          <Kpi label="Gross COD collected" value={formatMmk(totals.gross)} />
          <Kpi label="Rider earnings" value={formatMmk(totals.earnings)} tone="good" />
          <Kpi label="Mingalar share" value={formatMmk(totals.platform)} />
          <Kpi
            label={totals.net >= 0 ? 'Cash to collect' : 'Cash to pay out'}
            value={formatMmk(Math.abs(totals.net))}
            tone={totals.net >= 0 ? 'warn' : 'default'}
          />
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Not yet drafted                                                   */}
      {/* ---------------------------------------------------------------- */}
      {outstanding.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wallet className="size-4" />
              Unsettled balances ({outstanding.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              These riders hold ledger lines no settlement has claimed. Building the day drafts all
              of them at once; you can also draft one rider on their own.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {outstanding.map(({ position: p, existing, locked }) => (
              <div
                key={p.rider_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {p.full_name}
                    {existing ? <SettlementStatusBadge status={existing.status} /> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Collected {formatMmk(p.cod_collected)} · commission{' '}
                    {formatMmk(p.commission)} · handed in {formatMmk(p.cod_remitted)}
                    {p.entry_count ? ` · ${p.entry_count} entries` : ''}
                  </p>
                  {locked ? (
                    <p className="text-xs text-muted-foreground">
                      Their {date} settlement is already {existing?.status} and cannot be rebuilt.
                      This balance is new cash — it will be swept into the next day you build.
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'text-sm font-semibold tabular-nums',
                      p.open_balance < 0 && 'text-emerald-700',
                    )}
                  >
                    {formatMmk(p.open_balance)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null || locked}
                    title={locked ? 'Locked — approved and paid settlements are never rebuilt' : undefined}
                    onClick={() =>
                      run(`build-${p.rider_id}`, () => buildRiderSettlement(p.rider_id, date))
                    }
                  >
                    {busy === `build-${p.rider_id}` ? 'Drafting…' : existing ? 'Rebuild' : 'Draft'}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* This day's settlements                                            */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Settlements for {date}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {settlements.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              Nothing drafted for this day yet.
            </p>
          ) : (
            <SettlementTable
              rows={settlements}
              busy={busy}
              onApprove={(id) => run(`approve-${id}`, () => approveSettlement(id))}
              onPay={(id) => run(`pay-${id}`, () => markSettlementPaid(id, ''))}
            />
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Recent history                                                    */}
      {/* ---------------------------------------------------------------- */}
      {recent.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Recent settlements</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <SettlementTable rows={recent} busy={busy} showDate />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

function SettlementTable({
  rows,
  busy,
  showDate,
  onApprove,
  onPay,
}: {
  rows: SettlementRow[]
  busy: string | null
  showDate?: boolean
  onApprove?: (id: string) => void
  onPay?: (id: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] text-sm">
        <thead>
          <tr className="border-y bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Rider</th>
            {showDate ? <th className="px-3 py-2 font-medium">Day</th> : null}
            <th className="px-3 py-2 text-right font-medium">Orders</th>
            <th className="px-3 py-2 text-right font-medium">COD collected</th>
            <th className="px-3 py-2 text-right font-medium">Rider earns</th>
            <th className="px-3 py-2 text-right font-medium">Mingalar</th>
            <th className="px-3 py-2 text-right font-medium">Cash movement</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">&nbsp;</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((s) => {
            const payout = s.net_due_platform < 0
            return (
              <tr key={s.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/super/settlements/${s.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {s.rider?.full_name ?? 'Unknown rider'}
                  </Link>
                </td>
                {showDate ? (
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{s.period_date}</td>
                ) : null}
                <td className="px-3 py-2 text-right tabular-nums">{s.order_count}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMmk(s.gross_cod)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                  {formatMmk(s.rider_earnings)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMmk(s.platform_share)}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-semibold tabular-nums">
                    {formatMmk(Math.abs(s.net_due_platform))}
                  </span>
                  <span className="block text-[10px] uppercase text-muted-foreground">
                    {payout ? 'we pay rider' : 'rider hands in'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <SettlementStatusBadge status={s.status} />
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1.5">
                    {onApprove && s.status === 'submitted' ? (
                      <Button
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => onApprove(s.id)}
                      >
                        {busy === `approve-${s.id}` ? '…' : 'Approve'}
                      </Button>
                    ) : null}
                    {onPay && s.status === 'approved' ? (
                      <Button
                        size="sm"
                        variant="gold"
                        disabled={busy !== null}
                        onClick={() => onPay(s.id)}
                      >
                        <Banknote />
                        {busy === `pay-${s.id}` ? '…' : 'Mark paid'}
                      </Button>
                    ) : null}
                    <Link
                      href={`/admin/super/settlements/${s.id}`}
                      className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted"
                    >
                      Open
                    </Link>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
