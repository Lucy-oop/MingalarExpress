'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Download, FileText, Lock, MinusCircle, Wallet } from 'lucide-react'
import {
  bookPayrollAdjustment,
  lockPayPeriod,
  recordPayslipPayment,
  type PayrollResult,
} from '@/lib/admin/payroll'
import {
  ADJUSTMENT_CATEGORIES,
  CATEGORY_LABEL,
  PAYSLIP_METHODS,
  PAYSLIP_METHOD_LABEL,
  monthHasEnded,
  monthLabel,
  shiftMonth,
  variablePay,
} from '@/lib/payroll/payroll'
import type { PayrollMonth, PayslipWithName } from '@/lib/payroll/queries'
import { Overlay } from '@/components/ui/overlay'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatMmk } from '@/lib/utils'

/**
 * The month-end payroll workflow (0057):
 *
 *   1. pick the month (defaults to last month)
 *   2. review each rider: base + variable - deductions = net (a live preview
 *      until the month is locked)
 *   3. Lock -- once, after the month ends, with no open runs left in it
 *   4. record each payment (bank / cash / wallet + reference), once
 *
 * The database enforces every one of those rules; this screen explains them
 * before the button is pressed rather than after.
 */
export function PayrollBoard({
  data,
  riders,
  today,
}: {
  data: PayrollMonth
  riders: Array<{ id: string; name: string; baseSalary: number }>
  today: string
}) {
  const router = useRouter()
  const [feedback, setFeedback] = React.useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [busy, startTransition] = React.useTransition()
  const [paying, setPaying] = React.useState<PayslipWithName | null>(null)
  const [adjusting, setAdjusting] = React.useState(false)

  const month = data.month
  const ended = monthHasEnded(month, today)
  const go = (m: string) => router.push(`/admin/payroll?month=${m.slice(0, 7)}`)

  const run = (fn: () => Promise<PayrollResult>, after?: () => void) =>
    startTransition(async () => {
      setFeedback(null)
      const r = await fn()
      setFeedback({ tone: r.ok ? 'success' : 'error', message: r.message })
      if (r.ok) {
        after?.()
        router.refresh()
      }
    })

  // One shape for both states, so the table reads the same before and after the lock.
  const rows = data.locked
    ? data.payslips.map((p) => ({ key: p.id, name: p.full_name, fig: p, slip: p as PayslipWithName | null }))
    : data.preview.map((p) => ({ key: p.rider_id, name: p.full_name, fig: p, slip: null }))

  const totals = rows.reduce(
    (acc, r) => ({
      base: acc.base + r.fig.base_paid,
      variable: acc.variable + variablePay(r.fig),
      bonuses: acc.bonuses + r.fig.bonuses,
      deductions: acc.deductions + r.fig.deductions,
      net: acc.net + r.fig.net,
      paid: acc.paid + (r.slip?.status === 'paid' ? r.fig.net : 0),
    }),
    { base: 0, variable: 0, bonuses: 0, deductions: 0, net: 0, paid: 0 },
  )

  const lockBlocker = data.locked
    ? null
    : !ended
      ? `${monthLabel(month)} has not ended yet — it can be locked from ${shiftMonth(month, 1)}.`
      : data.openRuns > 0
        ? `${data.openRuns} run${data.openRuns === 1 ? ' is' : 's are'} still open in or before this month. Close or cancel ${data.openRuns === 1 ? 'it' : 'them'} on the Ways board first.`
        : null

  return (
    <div className="space-y-4">
      {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

      {/* ---- the month ---------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => go(shiftMonth(month, -1))}>
            <ChevronLeft />
          </Button>
          <Input
            type="month"
            value={month.slice(0, 7)}
            onChange={(e) => e.target.value && go(`${e.target.value}-01`)}
            className="w-44"
            aria-label="Pay month"
          />
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => go(shiftMonth(month, 1))}>
            <ChevronRight />
          </Button>
          <h2 className="ml-2 text-lg font-semibold">{monthLabel(month)}</h2>
          {data.locked ? <Badge tone="green">Locked</Badge> : <Badge tone="amber">Open — preview</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setAdjusting(true)}>
            <MinusCircle />
            Deduction / bonus
          </Button>
          {data.locked ? (
            <a href={`/admin/payroll/export?month=${month.slice(0, 7)}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <Download />
              CSV
            </a>
          ) : (
            <Button
              size="sm"
              disabled={busy || lockBlocker !== null || rows.length === 0}
              onClick={() => {
                if (
                  !window.confirm(
                    `Lock ${monthLabel(month)}? This creates ${rows.length} payslip${rows.length === 1 ? '' : 's'} and can never be undone — later corrections go on next month.`,
                  )
                )
                  return
                run(() => lockPayPeriod(month))
              }}
            >
              <Lock />
              Lock {monthLabel(month)}
            </Button>
          )}
        </div>
      </div>

      {lockBlocker ? <Alert tone="info">{lockBlocker}</Alert> : null}

      {/* ---- totals ------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Total label="Base salaries" value={totals.base} />
        <Total label="Variable earnings" value={totals.variable} />
        <Total label="Bonuses" value={totals.bonuses} />
        <Total label="Deductions" value={-totals.deductions} />
        <Total label="Net payroll" value={totals.net} strong />
        <Total label="Paid so far" value={totals.paid} />
      </div>

      {/* ---- riders ------------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Wallet className="size-4" />
            {data.locked ? `Payslips (${rows.length})` : `Preview (${rows.length} riders)`}
          </CardTitle>
          {!data.locked ? (
            <p className="text-xs text-muted-foreground">
              Live figures from the ledger. Nothing is final until the month is locked; any unpaid
              pay from earlier months is included.
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No rider has pay or deductions for this month.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Rider</th>
                    <th className="px-3 py-2 text-right font-medium">Base</th>
                    <th className="px-3 py-2 text-right font-medium">Variable</th>
                    <th className="px-3 py-2 text-right font-medium">Bonuses</th>
                    <th className="px-3 py-2 text-right font-medium">Deductions</th>
                    <th className="px-3 py-2 text-right font-medium">Net</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td className="px-3 py-2 font-medium">{r.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMmk(r.fig.base_paid)}
                        {r.fig.base_days < r.fig.days_in_month && r.fig.base_salary > 0 ? (
                          <span className="block text-[10px] text-muted-foreground">
                            {r.fig.base_days}/{r.fig.days_in_month} days
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMmk(variablePay(r.fig))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMmk(r.fig.bonuses)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMmk(-r.fig.deductions)}</td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right font-semibold tabular-nums',
                          r.fig.net < 0 && 'text-destructive',
                        )}
                      >
                        {formatMmk(r.fig.net)}
                      </td>
                      <td className="px-3 py-2">
                        {!r.slip ? (
                          <Badge tone="neutral">Preview</Badge>
                        ) : r.slip.status === 'paid' ? (
                          <Badge tone="green">Paid</Badge>
                        ) : r.fig.net <= 0 ? (
                          <Badge tone="red">Nothing to pay</Badge>
                        ) : (
                          <Badge tone="amber">To pay</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.slip ? (
                          <div className="flex justify-end gap-1.5">
                            <Link
                              href={`/admin/payroll/${r.slip.id}`}
                              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                            >
                              <FileText />
                              Payslip
                            </Link>
                            {r.slip.status === 'locked' && r.fig.net > 0 ? (
                              <Button size="sm" disabled={busy} onClick={() => setPaying(r.slip)}>
                                Record payment
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <PayDialog
        slip={paying}
        busy={busy}
        onClose={() => setPaying(null)}
        onPay={(method, reference) =>
          paying && run(() => recordPayslipPayment(paying.id, method, reference), () => setPaying(null))
        }
      />
      <AdjustDialog
        open={adjusting}
        month={month}
        riders={riders}
        busy={busy}
        onClose={() => setAdjusting(false)}
        onSubmit={(input) => run(() => bookPayrollAdjustment(input), () => setAdjusting(false))}
      />
    </div>
  )
}

function Total({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('tabular-nums', strong ? 'text-lg font-semibold' : 'font-medium')}>{formatMmk(value)}</p>
    </div>
  )
}

function PayDialog({
  slip,
  busy,
  onClose,
  onPay,
}: {
  slip: PayslipWithName | null
  busy: boolean
  onClose: () => void
  onPay: (method: string, reference: string) => void
}) {
  const [method, setMethod] = React.useState('bank')
  const [reference, setReference] = React.useState('')
  React.useEffect(() => {
    setMethod('bank')
    setReference('')
  }, [slip?.id])
  const needsRef = method !== 'cash'

  return (
    <Overlay
      open={slip !== null}
      onClose={onClose}
      side="center"
      title={slip ? `Pay ${slip.full_name} · ${monthLabel(slip.month)}` : ''}
      description={slip ? `Net pay ${formatMmk(slip.net)}` : undefined}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy || (needsRef && reference.trim() === '')} onClick={() => onPay(method, reference)}>
            {busy ? 'Recording…' : slip ? `Record ${formatMmk(slip.net)} paid` : 'Record'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Paid by" htmlFor="payMethod" required>
          <Select id="payMethod" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYSLIP_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYSLIP_METHOD_LABEL[m].en}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Transaction reference"
          htmlFor="payRef"
          required={needsRef}
          hint={needsRef ? undefined : 'Optional for cash — a receipt number if there is one.'}
        >
          <Input id="payRef" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <p className="text-xs text-muted-foreground">
          A payslip is paid once. This cannot be undone, and it is written to the audit log.
        </p>
      </div>
    </Overlay>
  )
}

function AdjustDialog({
  open,
  month,
  riders,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean
  month: string
  riders: Array<{ id: string; name: string }>
  busy: boolean
  onClose: () => void
  onSubmit: (input: {
    riderId: string
    month: string
    category: string
    direction: 'deduction' | 'bonus'
    amount: number
    reason: string
  }) => void
}) {
  const [riderId, setRiderId] = React.useState('')
  const [direction, setDirection] = React.useState<'deduction' | 'bonus'>('deduction')
  const [category, setCategory] = React.useState('shortfall')
  const [amount, setAmount] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [target, setTarget] = React.useState(month)
  React.useEffect(() => {
    if (open) {
      setRiderId('')
      setDirection('deduction')
      setCategory('shortfall')
      setAmount('')
      setReason('')
      setTarget(month)
    }
  }, [open, month])

  const parsed = Number(amount.replace(/[,\s]/g, ''))
  const valid = riderId && Number.isInteger(parsed) && parsed > 0 && reason.trim().length >= 3

  return (
    <Overlay
      open={open}
      onClose={onClose}
      side="center"
      title="Book a deduction or bonus"
      description="Permanent and audited. It lands on the payslip of the month you choose — or the next open one if that month is already locked."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || !valid}
            onClick={() => onSubmit({ riderId, month: target, category, direction, amount: parsed, reason })}
          >
            Book {direction}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rider" htmlFor="adjRider" required className="sm:col-span-2">
          <Select id="adjRider" value={riderId} onChange={(e) => setRiderId(e.target.value)}>
            <option value="">Choose a rider…</option>
            {riders.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type" htmlFor="adjDir" required>
          <Select
            id="adjDir"
            value={direction}
            onChange={(e) => {
              const d = e.target.value as 'deduction' | 'bonus'
              setDirection(d)
              setCategory(d === 'bonus' ? 'bonus' : 'shortfall')
            }}
          >
            <option value="deduction">Deduction</option>
            <option value="bonus">Bonus</option>
          </Select>
        </Field>
        <Field label="Category" htmlFor="adjCat" required>
          <Select id="adjCat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {ADJUSTMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c].en}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (Ks)" htmlFor="adjAmount" required>
          <Input id="adjAmount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Pay month" htmlFor="adjMonth" required>
          <Input
            id="adjMonth"
            type="month"
            value={target.slice(0, 7)}
            onChange={(e) => e.target.value && setTarget(`${e.target.value}-01`)}
          />
        </Field>
        <Field label="Reason" htmlFor="adjReason" required className="sm:col-span-2">
          <Input
            id="adjReason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Short 5,000 on run close, 12 Sep"
          />
        </Field>
      </div>
    </Overlay>
  )
}
