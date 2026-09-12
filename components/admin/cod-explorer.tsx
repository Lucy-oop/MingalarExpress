'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Scale, Store, Bike, BookOpen, Plus } from 'lucide-react'
import { bookAdjustment, type AdminResult } from '@/lib/admin/actions'
import type { CodPosition, LedgerLine, ShopPosition } from '@/lib/admin/queries'
import { LEDGER_KINDS, LEDGER_LABEL } from '@/lib/admin/ledger'
import type { LedgerKind } from '@/types/domain'
import { Kpi } from '@/components/admin/kpi'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatDateTimeYangon, formatMmk } from '@/lib/utils'

export type ExplorerView = 'riders' | 'shops' | 'ledger'

const TABS: Array<{ key: ExplorerView; label: string; icon: typeof Bike }> = [
  { key: 'riders', label: 'Riders', icon: Bike },
  { key: 'shops', label: 'Shops', icon: Store },
  { key: 'ledger', label: 'Ledger', icon: BookOpen },
]

export function CodExplorer({
  view,
  positions,
  shops,
  ledger,
  filters,
}: {
  view: ExplorerView
  positions: CodPosition[]
  shops: ShopPosition[]
  ledger: LedgerLine[]
  filters: { rider: string; kind: string; settled: string; from: string; to: string }
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setParam(patch: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v)
      else params.delete(k)
    }
    router.push(`/admin/audit?${params.toString()}`)
  }

  const riderNames = new Map(positions.map((p) => [p.rider_id, p.full_name]))

  // Fleet-wide totals. `open` is the money still on the street; `settled` is
  // what has been claimed by a settlement. Together they are every line ever
  // booked, which is what makes this a reconciliation and not a summary.
  const totals = positions.reduce(
    (acc, p) => ({
      collected: acc.collected + p.cod_collected,
      remitted: acc.remitted + p.cod_remitted,
      // Every kind of rider pay, not just commission. A route day books
      // trip_pay and a per_parcel day books commission + pickup_pay, so a
      // single-kind total read as zero on exactly the days it mattered.
      pay: acc.pay + p.commission + p.trip_pay + p.pickup_pay,
      open: acc.open + p.open_balance,
      settled: acc.settled + p.settled_total,
    }),
    { collected: 0, remitted: 0, pay: 0, open: 0, settled: 0 },
  )

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------------- */}
      {/* Fleet position                                                    */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi
          label="Uncollected (open)"
          value={formatMmk(totals.open)}
          hint="net cash riders still hold"
          tone={totals.open > 0 ? 'warn' : 'good'}
        />
        <Kpi label="Settled to date" value={formatMmk(totals.settled)} hint="claimed by settlements" />
        <Kpi label="COD ever collected" value={formatMmk(totals.collected)} />
        <Kpi label="Cash handed in" value={formatMmk(totals.remitted)} />
        <Kpi
          label="Rider pay booked"
          value={formatMmk(totals.pay)}
          hint="commission + trip + pickup"
          tone="good"
        />
      </div>

      <Alert tone="info">
        <span className="font-medium">Reading the signs.</span> Every line is signed:{' '}
        <strong>positive</strong> means the rider owes Mingalar (cash taken from a customer),{' '}
        <strong>negative</strong> means Mingalar owes the rider (commission earned, or cash already
        handed in). A rider&rsquo;s open balance is the sum over lines no settlement has claimed —
        which is exactly what dispatch gates COD offers on.
      </Alert>

      {/* ---------------------------------------------------------------- */}
      {/* Tabs                                                              */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border bg-card p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setParam({ view: key === 'riders' ? '' : key })}
            aria-current={view === key ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              view === key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {view === 'riders' ? <RiderPositions positions={positions} onDrill={setParam} /> : null}

      {view === 'shops' ? (
        <ShopPositions shops={shops} filters={filters} onFilter={setParam} />
      ) : null}

      {view === 'ledger' ? (
        <LedgerView
          ledger={ledger}
          positions={positions}
          riderNames={riderNames}
          filters={filters}
          onFilter={setParam}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Riders
// ---------------------------------------------------------------------------

function RiderPositions({
  positions,
  onDrill,
}: {
  positions: CodPosition[]
  onDrill: (patch: Record<string, string>) => void
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Scale className="size-4" />
          Rider positions ({positions.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Ordered by open balance. Derived from <code>cod_ledger</code>, never recomputed from
          orders.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {positions.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">No riders on the books yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-sm">
              <thead>
                <tr className="border-y bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Rider</th>
                  <th className="px-3 py-2 text-right font-medium">Collected</th>
                  <th className="px-3 py-2 text-right font-medium">Rider pay</th>
                  <th className="px-3 py-2 text-right font-medium">Handed in</th>
                  <th className="px-3 py-2 text-right font-medium">Adjustments</th>
                  <th className="px-3 py-2 text-right font-medium">Open</th>
                  <th className="px-3 py-2 text-right font-medium">Settled</th>
                  <th className="px-3 py-2 font-medium">Open since</th>
                  <th className="px-3 py-2 text-right font-medium">&nbsp;</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {positions.map((p) => {
                  const over = p.cod_float_limit > 0 && p.open_balance >= p.cod_float_limit
                  return (
                    <tr key={p.rider_id} className={cn(over && 'bg-destructive/5')}>
                      <td className="px-3 py-2">
                        <span className="font-medium">{p.full_name}</span>
                        <span className="ml-2 inline-flex gap-1 align-middle">
                          {!p.is_active ? <Badge tone="neutral">Suspended</Badge> : null}
                          {over ? <Badge tone="red">Over float</Badge> : null}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {p.base_area ?? 'no base ward'} · limit {formatMmk(p.cod_float_limit)} ·{' '}
                          {p.entry_count} entries
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMmk(p.cod_collected)}
                      </td>
                      {/*
                        ALL THREE PAY KINDS, WHICH IS WHAT MAKES THE ROW ADD UP.

                        This column was `commission` alone, and the table showed
                        no trip_pay and no pickup_pay at all — so the breakdown
                        never reconciled to the Open balance beside it, which is
                        a raw sum over every kind. On a route day it was short by
                        the whole run's pay; since 0042, also by 500 a collection.
                        On the one screen whose job is reconciliation.

                        Summed rather than given three columns: the table is
                        already min-w-[64rem], and the split is the sub-line —
                        which keeps 0008's point that an auditor needs to know
                        WHICH pay model produced the number, without another
                        3.5rem of width for a figure that is usually zero.
                      */}
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                        {formatMmk(p.commission + p.trip_pay + p.pickup_pay)}
                        {p.trip_pay > 0 || p.pickup_pay > 0 ? (
                          <span className="block text-[11px] font-normal text-muted-foreground">
                            {[
                              p.commission > 0 ? `${formatMmk(p.commission)} deliv` : null,
                              p.pickup_pay > 0 ? `${formatMmk(p.pickup_pay)} pickup` : null,
                              p.trip_pay > 0 ? `${formatMmk(p.trip_pay)} run` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMmk(p.cod_remitted)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.adjustments === 0 ? '—' : formatMmk(p.adjustments)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right font-semibold tabular-nums',
                          over && 'text-destructive',
                          p.open_balance < 0 && 'text-emerald-700',
                        )}
                      >
                        {formatMmk(p.open_balance)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {formatMmk(p.settled_total)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {p.open_since ? formatDateTimeYangon(p.open_since) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => onDrill({ view: 'ledger', rider: p.rider_id })}
                          className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted"
                        >
                          Lines
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------

function ShopPositions({
  shops,
  filters,
  onFilter,
}: {
  shops: ShopPosition[]
  filters: { from: string; to: string }
  onFilter: (patch: Record<string, string>) => void
}) {
  const totals = shops.reduce(
    (acc, s) => ({
      collected: acc.collected + s.cod_collected,
      goods: acc.goods + s.goods_value,
      fees: acc.fees + s.platform_fees,
      owed: acc.owed + s.owed_to_shop,
    }),
    { collected: 0, goods: 0, fees: 0, owed: 0 },
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Store className="size-4" />
          Shop positions ({shops.length})
        </CardTitle>
        <div className="flex flex-wrap items-end gap-3 pt-2">
          <div className="space-y-1.5">
            <label htmlFor="from" className="text-xs font-medium">
              From
            </label>
            <Input
              id="from"
              type="date"
              defaultValue={filters.from}
              onChange={(e) => onFilter({ from: e.target.value })}
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="to" className="text-xs font-medium">
              To
            </label>
            <Input
              id="to"
              type="date"
              defaultValue={filters.to}
              onChange={(e) => onFilter({ to: e.target.value })}
              className="w-40"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        <Alert tone="info" className="mx-5">
          The shop side is <strong>derived from orders</strong>, not from a ledger. The rider ledger
          is the book of record for cash Mingalar is owed; what Mingalar in turn owes each shop is
          computed here. If shop payouts ever need to be disputed or paid in instalments they need
          their own ledger — do not read this as one.
        </Alert>

        {shops.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">No shops in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="border-y bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Shop</th>
                  <th className="px-3 py-2 text-right font-medium">Delivered</th>
                  <th className="px-3 py-2 text-right font-medium">In transit</th>
                  <th className="px-3 py-2 text-right font-medium">COD collected</th>
                  <th className="px-3 py-2 text-right font-medium">Goods value</th>
                  <th className="px-3 py-2 text-right font-medium">Delivery fees</th>
                  <th className="px-3 py-2 text-right font-medium">Owed to shop</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shops.map((s) => (
                  <tr key={s.shop_id}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{s.shop_name}</span>
                      <span className="block text-xs text-muted-foreground">{s.owner_name}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.delivered}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {s.in_transit}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMmk(s.cod_collected)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMmk(s.goods_value)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMmk(s.platform_fees)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-semibold tabular-nums',
                        s.owed_to_shop < 0 && 'text-destructive',
                      )}
                    >
                      {formatMmk(s.owed_to_shop)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/50 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMmk(totals.collected)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMmk(totals.goods)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMmk(totals.fees)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMmk(totals.owed)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Raw ledger + adjustments
// ---------------------------------------------------------------------------

function LedgerView({
  ledger,
  positions,
  riderNames,
  filters,
  onFilter,
}: {
  ledger: LedgerLine[]
  positions: CodPosition[]
  riderNames: Map<string, string>
  filters: { rider: string; kind: string; settled: string }
  onFilter: (patch: Record<string, string>) => void
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Ledger lines</CardTitle>
          <div className="grid gap-3 pt-2 sm:grid-cols-3">
            <Field label="Rider" htmlFor="f-rider">
              <Select
                id="f-rider"
                value={filters.rider}
                onChange={(e) => onFilter({ rider: e.target.value })}
              >
                <option value="">All riders</option>
                {positions.map((p) => (
                  <option key={p.rider_id} value={p.rider_id}>
                    {p.full_name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Kind" htmlFor="f-kind">
              <Select
                id="f-kind"
                value={filters.kind}
                onChange={(e) => onFilter({ kind: e.target.value })}
              >
                <option value="">All kinds</option>
                {LEDGER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {LEDGER_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="State" htmlFor="f-settled">
              <Select
                id="f-settled"
                value={filters.settled}
                onChange={(e) => onFilter({ settled: e.target.value })}
              >
                <option value="">Open and settled</option>
                <option value="open">Uncollected (open)</option>
                <option value="settled">Settled</option>
              </Select>
            </Field>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {ledger.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No lines match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-y bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Rider</th>
                    <th className="px-3 py-2 font-medium">Kind</th>
                    <th className="px-3 py-2 font-medium">Memo</th>
                    <th className="px-3 py-2 font-medium">State</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ledger.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {formatDateTimeYangon(l.created_at)}
                      </td>
                      <td className="px-3 py-2">{riderNames.get(l.rider_id) ?? '—'}</td>
                      <td className="px-3 py-2">{LEDGER_LABEL[l.kind] ?? l.kind}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.memo ?? '—'}</td>
                      <td className="px-3 py-2">
                        {l.settlement_id ? (
                          <Link
                            href={`/admin/super/settlements/${l.settlement_id}`}
                            className="text-xs underline underline-offset-2"
                          >
                            Settled
                          </Link>
                        ) : (
                          <Badge tone="amber">Open</Badge>
                        )}
                      </td>
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
              </table>
            </div>
          )}
          {ledger.length >= 200 ? (
            <p className="border-t p-3 text-xs text-muted-foreground">
              Showing the most recent 200 lines. Narrow the filters to see further back.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <AdjustmentForm positions={positions} defaultRiderId={filters.rider} />
    </div>
  )
}

// ---------------------------------------------------------------------------

function AdjustmentForm({
  positions,
  defaultRiderId,
}: {
  positions: CodPosition[]
  defaultRiderId: string
}) {
  const [state, action] = useActionState<AdminResult, FormData>(bookAdjustment, {
    ok: false,
    message: '',
  })
  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const err = (k: string) => (state.ok ? undefined : state.fieldErrors?.[k]?.[0])

  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state])

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Plus />
          Book an adjustment
        </Button>
        {state.ok && state.message ? (
          <span className="text-sm text-emerald-700">{state.message}</span>
        ) : null}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Book an adjustment</CardTitle>
        <p className="text-xs text-muted-foreground">
          The ledger has no UPDATE or DELETE — for anyone, Super Admin included. A mistake is
          corrected by booking its opposite, which leaves both the error and the fix on the record.
          The line lands unsettled and is swept into the rider&rsquo;s next settlement.
        </p>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={action} className="space-y-3" noValidate>
          {state.message ? (
            <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Rider" htmlFor="riderId" required error={err('riderId')}>
              <Select id="riderId" name="riderId" defaultValue={defaultRiderId} required>
                <option value="">Select a rider</option>
                {positions.map((p) => (
                  <option key={p.rider_id} value={p.rider_id}>
                    {p.full_name} ({formatMmk(p.open_balance)} open)
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Direction" htmlFor="direction" required error={err('direction')}>
              <Select id="direction" name="direction" defaultValue="owed_by_rider" required>
                <option value="owed_by_rider">Rider owes Mingalar (+)</option>
                <option value="owed_to_rider">Mingalar owes rider (−)</option>
              </Select>
            </Field>

            <Field label="Amount (Ks)" htmlFor="amount" required error={err('amount')}>
              <Input id="amount" name="amount" type="number" min="1" step="1" required />
            </Field>

            <Field
              label="Reason"
              htmlFor="memo"
              required
              hint="Permanent. Be specific."
              error={err('memo')}
            >
              <Input
                id="memo"
                name="memo"
                placeholder="Short-paid MGE-260825-000123 by 500"
                required
              />
            </Field>
          </div>

          <div className="flex gap-2">
            <Button type="submit">Book adjustment</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
