'use client'

import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Percent, Save } from 'lucide-react'
import { updatePricing, type AdminResult } from '@/lib/admin/actions'
import {
  quoteTripPay,
  routeMargin,
  splitCommission,
  type RoutePayTier,
  type TripPayRates,
} from '@/lib/pricing'
import type { AppSettings } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatMmk } from '@/lib/utils'

/** Parcel counts the route preview is costed at: short, the rule, a full run. */
const PREVIEW_PARCELS = 20

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      <Save />
      {pending ? 'Saving…' : 'Save pricing'}
    </Button>
  )
}

export type RoutePreview = {
  id: string
  code: string
  name: string
  colour: string
  perParcelFee: number
}

export function PricingForm({
  settings,
  routes,
  tiers,
  rates,
  minParcels,
}: {
  settings: AppSettings
  routes: RoutePreview[]
  tiers: RoutePayTier[]
  rates: TripPayRates
  minParcels: number
}) {
  const [state, action] = useActionState<AdminResult, FormData>(updatePricing, {
    ok: false,
    message: '',
  })
  const err = (k: string) => (state.ok ? undefined : state.fieldErrors?.[k]?.[0])

  // The commission split is still LIVE: assign_order snapshots it onto every
  // per-parcel job (a Route Local ad-hoc drop, or a failed parcel handed to a
  // rider directly). Route runs pay by trip instead and never touch it.
  //
  // The distance knobs that used to live here — base fee, per-km, free km, road
  // factor — were removed when shop pricing moved to flat route fees. They are
  // no longer read by anything, so editing them changed nothing; the columns
  // remain in app_settings, marked deprecated.
  const [draft, setDraft] = useState({
    riderCommissionPct: Number(settings.rider_commission_pct),
  })

  const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value)
    setDraft((d) => ({ ...d, [k]: Number.isFinite(n) ? n : 0 }))
  }

  /**
   * What a route actually earns.
   *
   * The old preview priced a list of distances with `quoteFee`. Shops are no
   * longer billed that way — the fee is flat per route — so that table showed an
   * operator a number no shop would ever be charged.
   *
   * Margin is shown at the minimum-volume run because trip pay makes margin a
   * RESIDUAL, not a percentage: the same route loses money at 4 parcels and
   * makes money at 20, and the fee alone cannot tell you which.
   */
  const routeRows = useMemo(
    () =>
      routes.map((r) => {
        const pay = quoteTripPay(minParcels, 0, tiers, rates, r.id).total
        return { route: r, margin: routeMargin(minParcels, r.perParcelFee, pay) }
      }),
    [routes, tiers, rates, minParcels],
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
            <CardTitle className="text-sm">What shops are charged</CardTitle>
            <p className="text-xs text-muted-foreground">
              A flat fee per parcel, set by the destination&rsquo;s route. Edit these under
              Routes &mdash; they are not part of the form on the left.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Route</th>
                    <th className="px-3 py-2 text-right font-medium">Fee / parcel</th>
                    <th className="px-3 py-2 text-right font-medium">Rider @ {PREVIEW_PARCELS}</th>
                    <th className="px-3 py-2 text-right font-medium">Margin @ {PREVIEW_PARCELS}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {routeRows.map(({ route, margin }) => (
                    <tr key={route.id}>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: route.colour }}
                            aria-hidden="true"
                          />
                          {route.code.replace('ROUTE_', '')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {formatMmk(route.perParcelFee)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                        {formatMmk(margin.riderPay)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right tabular-nums',
                          margin.platform < 0 && 'font-semibold text-destructive',
                        )}
                      >
                        {formatMmk(margin.platform)}
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
