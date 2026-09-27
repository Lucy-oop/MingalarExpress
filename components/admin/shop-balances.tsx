'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Banknote, HandCoins, History } from 'lucide-react'
import { recordShopPayout } from '@/lib/admin/shop-payouts'
import type { ShopBalance, ShopPayoutRow } from '@/lib/admin/queries'
import { PAYOUT_METHODS, PAYOUT_METHOD_LABEL, payoutProblem } from '@/lib/shops/payout'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatDateTimeYangon, formatMmk } from '@/lib/utils'

/**
 * Every shop's all-time account, and the one button that pays a shop (0056).
 *
 * ALL TIME, unlike the period table below it. A payout settles money from
 * whenever it was earned, so the balance it is checked against cannot be a
 * date window -- a window would show a shop as owed money it was paid last
 * month, or hide money it earned before the window.
 *
 * AVAILABLE, not owed, is what can be paid: cash still with a rider on an open
 * run, or a KBZPay receipt not yet confirmed, is shown as pending and cannot
 * leave. record_shop_payout enforces that; this screen only explains it.
 */
export function ShopBalances({
  balances,
  payouts,
}: {
  balances: ShopBalance[]
  payouts: ShopPayoutRow[]
}) {
  const router = useRouter()
  const [paying, setPaying] = React.useState<ShopBalance | null>(null)
  const [feedback, setFeedback] = React.useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const nameById = React.useMemo(() => new Map(balances.map((b) => [b.shop_id, b.shop_name])), [balances])

  const totals = balances.reduce(
    (acc, b) => ({
      owed: acc.owed + b.owed_total,
      pending: acc.pending + b.pending_clearance,
      paid: acc.paid + b.paid_out,
      available: acc.available + Math.max(b.available, 0),
    }),
    { owed: 0, pending: 0, paid: 0, available: 0 },
  )

  return (
    <div className="space-y-4">
      {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <HandCoins className="size-4" />
            Shop balances — all time
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            <strong>Available</strong> is what has reached the office and can be paid now: cash from
            closed runs and confirmed KBZPay, less fees and payouts already made.{' '}
            <strong>Pending</strong> is still with a rider or awaiting KBZPay confirmation.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
            <Figure label="Owed to shops" value={totals.owed} />
            <Figure label="Pending clearance" value={totals.pending} />
            <Figure label="Paid out" value={totals.paid} />
            <Figure label="Available to pay" value={totals.available} strong />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Shop</th>
                  <th className="px-3 py-2 text-right font-medium">Owed</th>
                  <th className="px-3 py-2 text-right font-medium">Pending</th>
                  <th className="px-3 py-2 text-right font-medium">Paid out</th>
                  <th className="px-3 py-2 text-right font-medium">Available</th>
                  <th className="px-3 py-2 font-medium">Last payout</th>
                  <th className="px-3 py-2" aria-label="Action" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {balances.map((b) => (
                  <tr key={b.shop_id}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{b.shop_name}</span>
                      {b.is_direct ? <Badge tone="blue" className="ml-2">Direct</Badge> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMmk(b.owed_total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatMmk(b.pending_clearance)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMmk(b.paid_out)}</td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-semibold tabular-nums',
                        b.available > 0 ? 'text-emerald-700' : b.available < 0 ? 'text-destructive' : '',
                      )}
                    >
                      {formatMmk(b.available)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {b.last_payout_at ? formatDateTimeYangon(b.last_payout_at) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={b.available <= 0}
                        onClick={() => {
                          setFeedback(null)
                          setPaying(b)
                        }}
                      >
                        <Banknote />
                        Record payout
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="size-4" />
            Recent payouts
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {payouts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No payouts recorded yet.</p>
          ) : (
            <ul className="divide-y">
              {payouts.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{nameById.get(p.shopId) ?? 'Shop'}</span>
                    {p.recipient ? <span className="text-muted-foreground"> · to {p.recipient}</span> : null}
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTimeYangon(p.createdAt)} ·{' '}
                      {p.method ? PAYOUT_METHOD_LABEL[p.method as keyof typeof PAYOUT_METHOD_LABEL]?.en ?? p.method : '—'}
                      {p.reference ? ` · ref ${p.reference}` : ''}
                      {p.memo ? ` · ${p.memo}` : ''}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatMmk(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PayoutDialog
        shop={paying}
        onClose={() => setPaying(null)}
        onDone={(message) => {
          setPaying(null)
          setFeedback({ tone: 'success', message })
          router.refresh()
        }}
      />
    </div>
  )
}

function Figure({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('tabular-nums', strong ? 'text-lg font-semibold text-emerald-700' : 'font-medium')}>
        {formatMmk(value)}
      </p>
    </div>
  )
}

/** Amount, channel, reference -- checked here, and again on the server. */
function PayoutDialog({
  shop,
  onClose,
  onDone,
}: {
  shop: ShopBalance | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [amount, setAmount] = React.useState('')
  const [method, setMethod] = React.useState<string>('cash')
  const [reference, setReference] = React.useState('')
  const [recipient, setRecipient] = React.useState('')
  const [memo, setMemo] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  // A fresh form for every shop opened.
  React.useEffect(() => {
    setAmount('')
    setMethod('cash')
    setReference('')
    setRecipient('')
    setMemo('')
    setError(null)
  }, [shop?.shop_id])

  if (!shop) return <Overlay open={false} onClose={onClose} title="" side="center">{null}</Overlay>

  const parsed = Number(amount.replace(/[,\s]/g, ''))
  const problem = payoutProblem({
    amount: parsed,
    available: shop.available,
    method,
    reference,
    isDirect: shop.is_direct,
    recipient,
  })

  return (
    <Overlay
      open
      onClose={onClose}
      side="center"
      title={`Record payout · ${shop.shop_name}`}
      description={`Available to pay: ${formatMmk(shop.available)}`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending || problem !== null}
            onClick={() =>
              startTransition(async () => {
                setError(null)
                const r = await recordShopPayout({
                  shopId: shop.shop_id,
                  amount: parsed,
                  available: shop.available,
                  method,
                  reference,
                  memo,
                  isDirect: shop.is_direct,
                  recipient,
                })
                if (r.ok) onDone(r.message)
                else setError(r.message)
              })
            }
          >
            <Banknote />
            {pending ? 'Recording…' : parsed > 0 ? `Record ${formatMmk(parsed)} paid` : 'Record payout'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          label="Amount paid (Ks)"
          htmlFor="payoutAmount"
          required
          error={problem === 'over_available' ? 'More than is available to pay this shop.' : undefined}
        >
          <div className="flex gap-2">
            <Input
              id="payoutAmount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tabular-nums"
            />
            <Button type="button" variant="outline" onClick={() => setAmount(String(shop.available))}>
              All
            </Button>
          </div>
        </Field>
        <Field label="Paid by" htmlFor="payoutMethod" required>
          <Select id="payoutMethod" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYOUT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYOUT_METHOD_LABEL[m].en}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Transaction reference"
          htmlFor="payoutReference"
          required={method !== 'cash'}
          hint={method === 'cash' ? 'Optional for cash — a receipt number if there is one.' : undefined}
          error={problem === 'reference' ? 'Required for a transfer.' : undefined}
        >
          <Input id="payoutReference" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        {shop.is_direct ? (
          <Field
            label="Paid to (sender)"
            htmlFor="payoutRecipient"
            required
            hint="The Direct shop pools many senders — name the one this payout went to."
          >
            <Input id="payoutRecipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Note" htmlFor="payoutMemo">
          <Input id="payoutMemo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Weekly payout" />
        </Field>
        <p className="text-xs text-muted-foreground">
          A payout is permanent: it cannot be edited or deleted, and it is written to the audit log.
        </p>
      </div>
    </Overlay>
  )
}
