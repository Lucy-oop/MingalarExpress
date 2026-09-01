'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { BadgeCheck, Banknote, ChevronDown, Pencil, ShieldOff, Wallet } from 'lucide-react'
import { remitCod, setRiderActive, updateRider, type AdminResult } from '@/lib/admin/actions'
import type { AdminRider } from '@/lib/admin/queries'
import type { ServiceArea } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatDateTimeYangon, formatMmk, formatMyanmarPhone } from '@/lib/utils'

type Feedback = { tone: 'success' | 'error'; message: string }

export function RiderRoster({
  riders,
  areas,
  globalCommissionPct,
}: {
  riders: AdminRider[]
  areas: ServiceArea[]
  globalCommissionPct: number
}) {
  const router = useRouter()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const pending = riders.filter((r) => !r.isActive)
  const active = riders.filter((r) => r.isActive)

  function settle(result: AdminResult) {
    setFeedback({ tone: result.ok ? 'success' : 'error', message: result.message })
    if (result.ok) startTransition(() => router.refresh())
  }

  async function run(id: string, work: () => Promise<AdminResult>) {
    setBusyId(id)
    setFeedback(null)
    try {
      settle(await work())
    } catch {
      setFeedback({ tone: 'error', message: 'Network problem — nothing was saved. Try again.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

      {/* -------------------------------------------------------------- */}
      {/* Approval queue                                                  */}
      {/* -------------------------------------------------------------- */}
      {pending.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BadgeCheck className="size-4" />
              Awaiting approval ({pending.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              A held account cannot sign in and fails every RLS policy, so it is genuinely inert
              until approved — not merely hidden.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {pending.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatMyanmarPhone(r.phone)} · {r.baseArea ?? 'no base ward'} · {r.coverageKm}{' '}
                    km · {r.maxActiveOrders} parcels · float {formatMmk(r.codFloatLimit)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Registered {formatDateTimeYangon(r.createdAt)}
                    {r.vehiclePlate ? ` · plate ${r.vehiclePlate}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busyId === r.id}
                    onClick={() => run(r.id, () => setRiderActive(r.id, true))}
                  >
                    <BadgeCheck />
                    {busyId === r.id ? 'Approving…' : 'Approve'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                  >
                    <Pencil />
                    Edit first
                  </Button>
                </div>
                {editingId === r.id ? (
                  <div className="w-full">
                    <RiderEditor
                      rider={r}
                      areas={areas}
                      globalCommissionPct={globalCommissionPct}
                      busy={busyId === r.id}
                      onSubmit={(fd) => run(r.id, () => updateRider(r.id, fd))}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* -------------------------------------------------------------- */}
      {/* Roster                                                          */}
      {/* -------------------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Approved riders ({active.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {active.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              No approved riders yet. Register one above.
            </p>
          ) : (
            <ul className="divide-y">
              {active.map((r) => {
                const over = r.codFloatLimit > 0 && r.codInHand >= r.codFloatLimit
                const pct =
                  r.codFloatLimit > 0
                    ? Math.min(100, Math.round((r.codInHand / r.codFloatLimit) * 100))
                    : 0
                const expanded = editingId === r.id

                return (
                  <li key={r.id} className={cn(over && 'bg-destructive/5')}>
                    <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {r.fullName}
                          {r.isOnline ? (
                            <Badge tone="green">Online</Badge>
                          ) : (
                            <Badge tone="neutral">Offline</Badge>
                          )}
                          {r.availability === 'busy' ? <Badge tone="blue">Busy</Badge> : null}
                          {over ? <Badge tone="red">Over float</Badge> : null}
                          {r.commissionPctOverride !== null ? (
                            <Badge tone="gold">{r.commissionPctOverride}% override</Badge>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatMyanmarPhone(r.phone)} · {r.baseArea ?? 'no base ward'} ·{' '}
                          {r.coverageKm} km · {r.activeOrders}/{r.maxActiveOrders} parcels
                          {r.vehiclePlate ? ` · ${r.vehiclePlate}` : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Last ping {formatDateTimeYangon(r.lastPingAt)}
                        </p>

                        {/* Float usage — the number dispatch actually gates on. */}
                        <div className="mt-2 max-w-xs">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Cash in hand</span>
                            <span
                              className={cn(
                                'font-medium tabular-nums',
                                over && 'text-destructive',
                              )}
                            >
                              {formatMmk(r.codInHand)} / {formatMmk(r.codFloatLimit)}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                over
                                  ? 'bg-destructive'
                                  : pct > 70
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500',
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/audit?rider=${r.id}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted"
                        >
                          <Wallet className="size-3.5" />
                          Ledger
                        </Link>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingId(expanded ? null : r.id)}
                          aria-expanded={expanded}
                        >
                          <ChevronDown
                            className={cn('transition-transform', expanded && 'rotate-180')}
                          />
                          Manage
                        </Button>
                      </div>
                    </div>

                    {expanded ? (
                      <div className="space-y-4 border-t bg-muted/30 p-4">
                        <RiderEditor
                          rider={r}
                          areas={areas}
                          globalCommissionPct={globalCommissionPct}
                          busy={busyId === r.id}
                          onSubmit={(fd) => run(r.id, () => updateRider(r.id, fd))}
                        />

                        <DepositForm
                          rider={r}
                          busy={busyId === r.id}
                          onSubmit={(amount, memo) =>
                            run(r.id, () => remitCod(r.id, amount, memo))
                          }
                        />

                        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busyId === r.id}
                            onClick={() => run(r.id, () => setRiderActive(r.id, false))}
                          >
                            <ShieldOff />
                            Suspend rider
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            Refused while they are carrying parcels or holding cash — reassign and
                            settle first.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------

function RiderEditor({
  rider,
  areas,
  globalCommissionPct,
  busy,
  onSubmit,
}: {
  rider: AdminRider
  areas: ServiceArea[]
  globalCommissionPct: number
  busy: boolean
  onSubmit: (fd: FormData) => void
}) {
  return (
    <form action={onSubmit} className="space-y-3 rounded-md border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Operating parameters
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Base ward" htmlFor={`area-${rider.id}`}>
          <Select
            id={`area-${rider.id}`}
            name="baseAreaId"
            defaultValue={rider.baseAreaId ?? ''}
          >
            <option value="">No base ward</option>
            {areas
              .filter((a) => a.is_active || a.id === rider.baseAreaId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.is_active ? '' : ' (inactive)'}
                </option>
              ))}
          </Select>
        </Field>

        <Field label="Coverage radius (km)" htmlFor={`cov-${rider.id}`}>
          <Input
            id={`cov-${rider.id}`}
            name="coverageKm"
            type="number"
            step="0.5"
            min="0.5"
            max="30"
            defaultValue={rider.coverageKm}
          />
        </Field>

        <Field label="Max parcels" htmlFor={`cap-${rider.id}`}>
          <Input
            id={`cap-${rider.id}`}
            name="maxActiveOrders"
            type="number"
            min="1"
            max="10"
            defaultValue={rider.maxActiveOrders}
          />
        </Field>

        <Field label="COD float limit (Ks)" htmlFor={`float-${rider.id}`}>
          <Input
            id={`float-${rider.id}`}
            name="codFloatLimit"
            type="number"
            min="0"
            step="1000"
            defaultValue={rider.codFloatLimit}
          />
        </Field>

        <Field
          label="Commission override (%)"
          htmlFor={`comm-${rider.id}`}
          hint={`Blank = the standard ${globalCommissionPct}%`}
        >
          <Input
            id={`comm-${rider.id}`}
            name="commissionPctOverride"
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder={String(globalCommissionPct)}
            defaultValue={rider.commissionPctOverride ?? ''}
          />
        </Field>

        <Field label="Vehicle plate" htmlFor={`plate-${rider.id}`}>
          <Input
            id={`plate-${rider.id}`}
            name="vehiclePlate"
            defaultValue={rider.vehiclePlate ?? ''}
          />
        </Field>
      </div>
      <Button size="sm" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save settings'}
      </Button>
    </form>
  )
}

// ---------------------------------------------------------------------------

function DepositForm({
  rider,
  busy,
  onSubmit,
}: {
  rider: AdminRider
  busy: boolean
  onSubmit: (amount: number, memo: string) => void
}) {
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')

  const parsed = Number(amount)
  const valid = Number.isInteger(parsed) && parsed > 0 && parsed <= rider.codInHand

  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Take a cash deposit
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        For cash handed in mid-shift, before any settlement is built. It books a negative ledger
        line, so their COD headroom recovers immediately.
      </p>

      {rider.codInHand <= 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing outstanding — this rider is holding no company cash.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <Field label="Amount (Ks)" htmlFor={`dep-${rider.id}`} className="w-40">
            <Input
              id={`dep-${rider.id}`}
              type="number"
              min="1"
              max={rider.codInHand}
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={String(rider.codInHand)}
            />
          </Field>
          <Field label="Memo" htmlFor={`memo-${rider.id}`} className="min-w-48 flex-1">
            <Input
              id={`memo-${rider.id}`}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Cash handed in"
            />
          </Field>
          <div className="flex gap-2 pb-0.5">
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setAmount(String(rider.codInHand))}
            >
              All {formatMmk(rider.codInHand)}
            </Button>
            <Button
              size="sm"
              type="button"
              disabled={busy || !valid}
              onClick={() => onSubmit(parsed, memo)}
            >
              <Banknote />
              {busy ? 'Recording…' : 'Record deposit'}
            </Button>
          </div>
        </div>
      )}

      {amount !== '' && !valid ? (
        <p className="mt-1 text-xs font-medium text-destructive">
          {parsed > rider.codInHand
            ? `They are only holding ${formatMmk(rider.codInHand)} — a deposit cannot exceed that.`
            : 'Enter a whole number of kyat greater than zero.'}
        </p>
      ) : null}
    </div>
  )
}
