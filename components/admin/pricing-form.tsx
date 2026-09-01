'use client'

import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Percent, Save } from 'lucide-react'
import { updatePricing, type AdminResult } from '@/lib/admin/actions'
import { quoteFee, splitCommission } from '@/lib/pricing'
import type { AppSettings } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMmk } from '@/lib/utils'

/** Crow-fly distances the preview prices. Typical Thingangyun hops. */
const PREVIEW_KM = [0.8, 1.5, 2.5, 4, 6, 9]

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      <Save />
      {pending ? 'Saving…' : 'Save pricing'}
    </Button>
  )
}

export function PricingForm({ settings }: { settings: AppSettings }) {
  const [state, action] = useActionState<AdminResult, FormData>(updatePricing, {
    ok: false,
    message: '',
  })
  const err = (k: string) => (state.ok ? undefined : state.fieldErrors?.[k]?.[0])

  // Draft values drive the preview so the operator sees the new tier table
  // before committing. Nothing here is authoritative — createOrder recomputes
  // every fee server-side from app_settings, never from the browser.
  const [draft, setDraft] = useState({
    riderCommissionPct: Number(settings.rider_commission_pct),
    baseDeliveryFee: Number(settings.base_delivery_fee),
    perKmFee: Number(settings.per_km_fee),
    freeKm: Number(settings.free_km),
    roadFactor: Number(settings.road_factor),
  })

  const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value)
    setDraft((d) => ({ ...d, [k]: Number.isFinite(n) ? n : 0 }))
  }

  const tiers = useMemo(
    () =>
      PREVIEW_KM.map((crow) => {
        const quote = quoteFee(crow, {
          base_delivery_fee: draft.baseDeliveryFee,
          per_km_fee: draft.perKmFee,
          free_km: draft.freeKm,
          road_factor: draft.roadFactor,
          rider_commission_pct: draft.riderCommissionPct,
        })
        return { crow, quote, split: splitCommission(quote.total, draft.riderCommissionPct) }
      }),
    [draft],
  )

  const platformPct = Math.round((100 - draft.riderCommissionPct) * 100) / 100

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <form action={action} className="space-y-4" noValidate>
        {state.message ? (
          <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert>
        ) : null}

        {/* ---------------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Percent className="size-4" />
              Commission split
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Rider share (%)"
                htmlFor="riderCommissionPct"
                required
                hint="Applied to the delivery fee, not to the goods value."
                error={err('riderCommissionPct')}
              >
                <Input
                  id="riderCommissionPct"
                  name="riderCommissionPct"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={draft.riderCommissionPct}
                  onChange={set('riderCommissionPct')}
                  required
                  aria-invalid={!!err('riderCommissionPct')}
                />
              </Field>

              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Resulting split
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {draft.riderCommissionPct}% rider / {platformPct}% Mingalar
                </p>
              </div>
            </div>

            <Alert tone="info">
              Changing the split does <strong>not</strong> touch orders already assigned. The rate
              is snapshotted onto the order at assignment time, so last month&rsquo;s settlements
              never get rewritten. A per-rider override on the roster beats this rate.
            </Alert>
          </CardContent>
        </Card>

        {/* ---------------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Delivery fee tiers</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Base fee (Ks)"
              htmlFor="baseDeliveryFee"
              required
              hint="Covers the free allowance below."
              error={err('baseDeliveryFee')}
            >
              <Input
                id="baseDeliveryFee"
                name="baseDeliveryFee"
                type="number"
                min="0"
                step="100"
                value={draft.baseDeliveryFee}
                onChange={set('baseDeliveryFee')}
                required
                aria-invalid={!!err('baseDeliveryFee')}
              />
            </Field>

            <Field
              label="Free allowance (km)"
              htmlFor="freeKm"
              required
              hint="Road distance included in the base fee."
              error={err('freeKm')}
            >
              <Input
                id="freeKm"
                name="freeKm"
                type="number"
                step="0.1"
                min="0"
                value={draft.freeKm}
                onChange={set('freeKm')}
                required
                aria-invalid={!!err('freeKm')}
              />
            </Field>

            <Field
              label="Per extra km (Ks)"
              htmlFor="perKmFee"
              required
              hint="Each STARTED kilometre past the allowance."
              error={err('perKmFee')}
            >
              <Input
                id="perKmFee"
                name="perKmFee"
                type="number"
                min="0"
                step="50"
                value={draft.perKmFee}
                onChange={set('perKmFee')}
                required
                aria-invalid={!!err('perKmFee')}
              />
            </Field>

            <Field
              label="Road factor"
              htmlFor="roadFactor"
              required
              hint="Straight line × this ≈ road distance. 1.35 fits Yangon."
              error={err('roadFactor')}
            >
              <Input
                id="roadFactor"
                name="roadFactor"
                type="number"
                step="0.05"
                min="1"
                max="3"
                value={draft.roadFactor}
                onChange={set('roadFactor')}
                required
                aria-invalid={!!err('roadFactor')}
              />
            </Field>
          </CardContent>
        </Card>

        {/* ---------------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Dispatch tuning</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Default coverage radius (km)"
              htmlFor="defaultCoverageKm"
              required
              hint="Given to newly registered riders."
              error={err('defaultCoverageKm')}
            >
              <Input
                id="defaultCoverageKm"
                name="defaultCoverageKm"
                type="number"
                step="0.5"
                min="0.5"
                max="30"
                defaultValue={Number(settings.default_coverage_km)}
                required
                aria-invalid={!!err('defaultCoverageKm')}
              />
            </Field>

            {/* The number depart_trip() enforces and the planning board warns
                at. Distinct from break-even (about 5-7 parcels): a 14-parcel run
                makes money but still fails this rule. */}
            <Field
              label="Minimum parcels per run"
              htmlFor="minParcelsPerTrip"
              required
              hint="Runs under this need a logged override to depart. 0 switches the rule off."
              error={err('minParcelsPerTrip')}
            >
              <Input
                id="minParcelsPerTrip"
                name="minParcelsPerTrip"
                type="number"
                min="0"
                max="500"
                defaultValue={settings.min_parcels_per_trip}
                required
                aria-invalid={!!err('minParcelsPerTrip')}
              />
            </Field>

            <Field
              label="Ping considered stale after (minutes)"
              htmlFor="riderPingStaleMin"
              required
              error={err('riderPingStaleMin')}
            >
              <Input
                id="riderPingStaleMin"
                name="riderPingStaleMin"
                type="number"
                min="1"
                max="120"
                defaultValue={settings.rider_ping_stale_min}
                required
                aria-invalid={!!err('riderPingStaleMin')}
              />
            </Field>

            <Field
              label="Support phone"
              htmlFor="supportPhone"
              hint="Shown to shops and customers."
              error={err('supportPhone')}
            >
              <Input
                id="supportPhone"
                name="supportPhone"
                type="tel"
                inputMode="tel"
                placeholder="09 791 234 567"
                defaultValue={settings.support_phone ?? ''}
              />
            </Field>
          </CardContent>
        </Card>

        <SaveButton />
      </form>

      {/* ------------------------------------------------------------ */}
      {/* Live preview                                                  */}
      {/* ------------------------------------------------------------ */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">What shops will be quoted</CardTitle>
            <p className="text-xs text-muted-foreground">
              Recomputed live from the values on the left. Not yet saved.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Straight</th>
                    <th className="px-3 py-2 font-medium">Road</th>
                    <th className="px-3 py-2 text-right font-medium">Fee</th>
                    <th className="px-3 py-2 text-right font-medium">Rider</th>
                    <th className="px-3 py-2 text-right font-medium">Mingalar</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tiers.map(({ crow, quote, split }) => (
                    <tr key={crow}>
                      <td className="px-3 py-2 tabular-nums">{crow.toFixed(1)} km</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {quote.roadKm.toFixed(1)} km
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {formatMmk(quote.total)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                        {formatMmk(split.rider)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMmk(split.platform)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t p-3 text-xs text-muted-foreground">
              The rider&rsquo;s cut is floored and Mingalar takes the remainder, so the two always
              sum to the fee exactly — that is what the{' '}
              <code>orders_commission_split_sane</code> constraint checks.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
