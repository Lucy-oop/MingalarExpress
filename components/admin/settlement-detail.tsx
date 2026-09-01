'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Banknote, CheckCircle2, Undo2 } from 'lucide-react'
import {
  approveSettlement,
  markSettlementPaid,
  reopenSettlement,
  type AdminResult,
} from '@/lib/admin/actions'
import type { SettlementDetail as SettlementDetailData } from '@/lib/admin/queries'
import { LEDGER_LABEL } from '@/lib/admin/ledger'
import { SettlementStatusBadge } from '@/components/admin/settlement-status'
import { Stat } from '@/components/admin/kpi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatDateTimeYangon, formatMmk, formatMyanmarPhone } from '@/lib/utils'

type Feedback = { tone: 'success' | 'error'; message: string }

export function SettlementDetail({ data }: { data: SettlementDetailData }) {
  const { settlement: s, rider, lines } = data
  const router = useRouter()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [payNote, setPayNote] = useState('')
  const [reopenReason, setReopenReason] = useState('')
  const [reopening, setReopening] = useState(false)
  const [, startTransition] = useTransition()

  const payout = s.net_due_platform < 0

  async function run(key: string, work: () => Promise<AdminResult>) {
    setBusy(key)
    setFeedback(null)
    try {
      const result = await work()
      setFeedback({ tone: result.ok ? 'success' : 'error', message: result.message })
      if (result.ok) {
        setReopening(false)
        setReopenReason('')
        startTransition(() => router.refresh())
      }
    } catch {
      setFeedback({ tone: 'error', message: 'Network problem — nothing was saved. Try again.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <Link
        href={`/admin/super/settlements?date=${s.period_date}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to {s.period_date}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            {rider?.full_name ?? 'Unknown rider'}
            <SettlementStatusBadge status={s.status} />
          </h1>
          <p className="text-sm text-muted-foreground">
            {s.period_date} · {formatMyanmarPhone(rider?.phone)} · {s.order_count} order
            {s.order_count === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

      {/* ---------------------------------------------------------------- */}
      {/* The arithmetic                                                    */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">How this settles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="COD collected" value={formatMmk(s.gross_cod)} emphasis />
            <Stat label="Delivery fees" value={formatMmk(s.delivery_fees)} />
            <Stat label="Rider earnings" value={formatMmk(s.rider_earnings)} emphasis />
            <Stat label="Mingalar share" value={formatMmk(s.platform_share)} />
            <Stat
              label={payout ? 'Payout to rider' : 'Cash rider hands in'}
              value={formatMmk(Math.abs(s.net_due_platform))}
              emphasis
            />
          </div>

          <div
            className={cn(
              'rounded-md border p-3 text-sm',
              payout ? 'border-blue-200 bg-blue-50' : 'border-amber-300 bg-amber-50',
            )}
          >
            <p className="font-medium">
              {payout
                ? `Mingalar pays ${rider?.full_name ?? 'the rider'} ${formatMmk(Math.abs(s.net_due_platform))}.`
                : `${rider?.full_name ?? 'The rider'} hands in ${formatMmk(s.net_due_platform)}.`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatMmk(s.gross_cod)} collected − {formatMmk(s.rider_earnings)} commission ={' '}
              {formatMmk(s.net_due_platform)}.{' '}
              {payout
                ? 'Negative because prepaid deliveries earn commission with no cash collected.'
                : 'Any cash already handed in mid-shift is netted off — it is a negative line below.'}
            </p>
          </div>

          <Alert tone="info">
            These ledger lines are already <strong>claimed</strong>: the rider&rsquo;s open balance
            cleared the moment this settlement was built. Approval and payment track the physical
            cash and the payout, which is a separate matter from the book.
          </Alert>

          {s.notes ? (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Notes
              </p>
              <p className="mt-0.5 whitespace-pre-wrap">{s.notes}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>Built {formatDateTimeYangon(s.created_at)}</span>
            {s.approved_at ? <span>Approved {formatDateTimeYangon(s.approved_at)}</span> : null}
            {s.paid_at ? <span>Paid {formatDateTimeYangon(s.paid_at)}</span> : null}
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Actions                                                           */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {s.status === 'submitted' ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={busy !== null}
                onClick={() => run('approve', () => approveSettlement(s.id))}
              >
                <CheckCircle2 />
                {busy === 'approve' ? 'Approving…' : 'Approve settlement'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Confirms the figures. The cash movement is recorded separately when you mark it
                paid.
              </p>
            </div>
          ) : null}

          {s.status === 'approved' ? (
            <div className="space-y-3">
              <Field
                label="Payment note"
                htmlFor="payNote"
                hint="Optional — receipt number, who took the cash, KBZPay reference."
              >
                <Input
                  id="payNote"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="Cash taken by U Aung, receipt 0412"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="gold"
                  disabled={busy !== null}
                  onClick={() => run('pay', () => markSettlementPaid(s.id, payNote))}
                >
                  <Banknote />
                  {busy === 'pay' ? 'Recording…' : payout ? 'Mark paid out' : 'Mark cash received'}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => setReopening((r) => !r)}
                >
                  <Undo2 />
                  Reopen for correction
                </Button>
              </div>

              {reopening ? (
                <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                  <Field label="Why are you reopening this?" htmlFor="reason" required>
                    <Textarea
                      id="reason"
                      value={reopenReason}
                      onChange={(e) => setReopenReason(e.target.value)}
                      placeholder="Rider disputes the count on MGE-260825-000123"
                    />
                  </Field>
                  <p className="text-xs text-muted-foreground">
                    Reopening is the only reverse gear and it is written to the audit log. It moves
                    the settlement back to drafted so it can be rebuilt.
                  </p>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy !== null || reopenReason.trim().length === 0}
                    onClick={() => run('reopen', () => reopenSettlement(s.id, reopenReason))}
                  >
                    {busy === 'reopen' ? 'Reopening…' : 'Reopen settlement'}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {s.status === 'paid' ? (
            <Alert tone="success" title="Settled and paid">
              A paid settlement is final and is never edited. If something is wrong, book a
              correcting adjustment against the rider in the{' '}
              <Link href={`/admin/audit?rider=${s.rider_id}`} className="underline underline-offset-2">
                COD audit explorer
              </Link>{' '}
              — it will be swept into their next settlement.
            </Alert>
          ) : null}

          {s.status === 'open' ? (
            <Alert tone="info">
              This settlement has no claimed lines yet. Build the day again to populate it.
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Ledger lines                                                      */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Claimed ledger lines ({lines.length})</CardTitle>
          <p className="text-xs text-muted-foreground">
            Positive = the rider owes Mingalar. Negative = Mingalar owes the rider.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No lines claimed.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-sm">
                <thead>
                  <tr className="border-y bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Kind</th>
                    <th className="px-3 py-2 font-medium">Order</th>
                    <th className="px-3 py-2 font-medium">Memo</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {formatDateTimeYangon(l.created_at)}
                      </td>
                      <td className="px-3 py-2">{LEDGER_LABEL[l.kind] ?? l.kind}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">
                        {l.order_code ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{l.memo ?? '—'}</td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right font-medium tabular-nums',
                          l.amount < 0 && 'text-emerald-700',
                        )}
                      >
                        {l.amount < 0 ? '−' : '+'}
                        {formatMmk(Math.abs(l.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/50 font-semibold">
                    <td className="px-3 py-2" colSpan={4}>
                      Net
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMmk(lines.reduce((n, l) => n + l.amount, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
