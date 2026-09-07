'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Plus, X } from 'lucide-react'
import { saveZone, type AdminResult } from '@/lib/admin/actions'
import type { ZoneRow } from '@/lib/admin/queries'
import { formatMmk } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Feedback = { tone: 'success' | 'error'; message: string }

/**
 * THE RATE CARD, editable.
 *
 * The fee lives in a table rather than in `lib/pricing.ts` because it has
 * already changed once: what a shop pays used to be `routes.per_parcel_fee`, a
 * per-route number, and the business then drew the map by zone instead — at
 * which point Route C spanned a 4,000 Ks township and a 5,000 Ks industrial
 * pocket and could no longer express one price. The next revision should be an
 * afternoon on this screen, not a migration and a deploy.
 *
 * Deliberately NOT here: rider pay. `route_pay_tiers` and `routes.per_parcel_fee`
 * still drive what a rider earns and whether a run is worth sending, and moving
 * the customer price never touched them. Two different questions.
 *
 * There is no delete, for the same reason wards have none: `service_areas.zone_id`
 * is NOT NULL and the reference is ON DELETE RESTRICT, so a zone that still
 * prices areas cannot be dropped. Switching it off is the real action, and it is
 * a loud one — every area it prices leaves the shop's booking list at once.
 */
export function ZoneManager({ zones }: { zones: ZoneRow[] }) {
  const router = useRouter()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  async function submit(zoneId: string | null, fd: FormData) {
    setBusy(true)
    setFeedback(null)
    setFieldErrors(null)
    try {
      const result: AdminResult = await saveZone(zoneId, fd)
      setFeedback({ tone: result.ok ? 'success' : 'error', message: result.message })
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? null)
      } else {
        setEditingId(null)
        setAdding(false)
        startTransition(() => router.refresh())
      }
    } catch {
      setFeedback({ tone: 'error', message: 'Network problem — nothing was saved. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const priced = zones.filter((z) => z.isActive)
  /*
    ON THE RATE CARD, NOT YET SELLABLE. 0033 created the printed card's 21
    townships and could not invent which run visits them, so they went in
    switched off. Every one needs the same thing — a route mapping — and this
    warning is the only place anyone would find that out.
  */
  const waiting = zones.flatMap((z) => z.waiting)

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="text-sm">Delivery rates ({priced.length} active)</CardTitle>
          <p className="text-xs text-muted-foreground">
            What a shop pays per parcel. Orders already booked keep the fee they were quoted.
          </p>
        </div>
        <Button
          size="sm"
          variant={adding ? 'ghost' : 'outline'}
          className="w-full sm:w-auto"
          onClick={() => {
            setAdding((a) => !a)
            setEditingId(null)
          }}
        >
          {adding ? <X /> : <Plus />}
          {adding ? 'Cancel' : 'Add zone'}
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

        {waiting.length > 0 ? (
          <Alert tone="warning">
            <span className="font-medium">
              {waiting.length} area{waiting.length === 1 ? '' : 's'} priced but not bookable
            </span>{' '}
            — no shop can pick {waiting.length === 1 ? 'it' : 'them'} yet.
            <ul className="mt-1.5 space-y-0.5">
              {waiting.slice(0, 24).map((w) => (
                <li key={w.name}>
                  {w.name} <span className="opacity-70">· {w.why}</span>
                </li>
              ))}
              {waiting.length > 24 ? <li className="opacity-70">…and {waiting.length - 24} more</li> : null}
            </ul>
            <p className="mt-1.5">
              Map each to a route on the Routes board, then switch the ward on under Wards below.
            </p>
          </Alert>
        ) : null}

        {adding ? (
          <ZoneForm
            zone={null}
            busy={busy}
            fieldErrors={fieldErrors}
            nextSortOrder={(zones.at(-1)?.sortOrder ?? 0) + 10}
            onSubmit={(fd) => submit(null, fd)}
            onCancel={() => setAdding(false)}
          />
        ) : null}

        {zones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No zones yet. Until one exists no ward can be priced and no shop can book.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {zones.map((z) => (
              <li key={z.id}>
                <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {z.name}
                      {z.nameMm ? <span className="text-muted-foreground">{z.nameMm}</span> : null}
                      {z.isActive ? (
                        <Badge tone="green">Active</Badge>
                      ) : (
                        <Badge tone="neutral">Off</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{formatMmk(z.fee)}</span> per
                      parcel · {z.deliveryDays} day{z.deliveryDays === 1 ? '' : 's'} ·{' '}
                      {z.bookableCount} of {z.areaCount} area
                      {z.areaCount === 1 ? '' : 's'} ready
                      {z.waiting.length > 0 ? (
                        <span className="text-amber-700 dark:text-amber-500">
                          {' '}
                          · {z.waiting.length} waiting
                        </span>
                      ) : null}
                      {/* An off zone has no price, so none of its areas can be
                          booked however ready they are. Said here rather than
                          folded into the count above, which would leave a row
                          reading "0 of 24 · 0 waiting" and nothing to act on. */}
                      {!z.isActive && z.areaCount > 0 ? (
                        <span className="text-amber-700 dark:text-amber-500">
                          {' '}
                          · none bookable while off
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingId(editingId === z.id ? null : z.id)
                      setAdding(false)
                      setFieldErrors(null)
                    }}
                  >
                    {editingId === z.id ? 'Close' : 'Edit'}
                  </Button>
                </div>

                {editingId === z.id ? (
                  <div className="border-t bg-muted/30 p-3">
                    <ZoneForm
                      zone={z}
                      busy={busy}
                      fieldErrors={fieldErrors}
                      onSubmit={(fd) => submit(z.id, fd)}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------

function ZoneForm({
  zone,
  busy,
  fieldErrors,
  nextSortOrder,
  onSubmit,
  onCancel,
}: {
  zone: ZoneRow | null
  busy: boolean
  fieldErrors: Record<string, string[]> | null
  nextSortOrder?: number
  onSubmit: (fd: FormData) => void
  onCancel: () => void
}) {
  const id = zone?.id ?? 'new'
  const err = (k: string) => fieldErrors?.[k]?.[0]

  return (
    <form action={onSubmit} className="space-y-3 rounded-md border bg-background p-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Zone name" htmlFor={`zname-${id}`} required error={err('name')}>
          <Input
            id={`zname-${id}`}
            name="name"
            defaultValue={zone?.name ?? ''}
            placeholder="Zone 3 — Bago road"
            required
            aria-invalid={!!err('name')}
          />
        </Field>

        <Field label="Name (Myanmar)" htmlFor={`znameMm-${id}`} error={err('nameMm')}>
          <Input id={`znameMm-${id}`} name="nameMm" defaultValue={zone?.nameMm ?? ''} />
        </Field>

        <Field
          label="Fee per parcel (Ks)"
          htmlFor={`zfee-${id}`}
          required
          hint="Charged to the shop."
          error={err('fee')}
        >
          <Input
            id={`zfee-${id}`}
            name="fee"
            type="number"
            inputMode="numeric"
            min="0"
            step="100"
            defaultValue={zone?.fee ?? 4000}
            required
            aria-invalid={!!err('fee')}
          />
        </Field>

        <Field
          label="Delivery days"
          htmlFor={`zdays-${id}`}
          required
          hint="What the rate card promises."
          error={err('deliveryDays')}
        >
          <Input
            id={`zdays-${id}`}
            name="deliveryDays"
            type="number"
            inputMode="numeric"
            min="1"
            max="30"
            defaultValue={zone?.deliveryDays ?? 3}
            required
            aria-invalid={!!err('deliveryDays')}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Sort order"
          htmlFor={`zsort-${id}`}
          hint="Lower shows first."
          error={err('sortOrder')}
        >
          <Input
            id={`zsort-${id}`}
            name="sortOrder"
            type="number"
            min="0"
            defaultValue={zone?.sortOrder ?? nextSortOrder ?? 100}
          />
        </Field>

        <div className="flex items-end pb-1.5">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isActive"
              className="size-4"
              defaultChecked={zone?.isActive ?? true}
            />
            Active
          </label>
        </div>
      </div>

      {/*
        THE CONSEQUENCE OF SWITCHING ONE OFF, said before it is switched off. An
        inactive zone has no price, so `toAreaRoute` drops every area it covers
        and the shop's booking list loses them without explanation.
      */}
      {zone && zone.areaCount > 0 ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {zone.areaCount} area{zone.areaCount === 1 ? '' : 's'} are priced by this zone.
            Switching it off removes {zone.areaCount === 1 ? 'it' : 'them'} from every shop&rsquo;s
            booking list. Raising the fee affects new orders only.
          </span>
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="sm" type="submit" disabled={busy}>
          {busy ? 'Saving…' : zone ? 'Save zone' : 'Add zone'}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
