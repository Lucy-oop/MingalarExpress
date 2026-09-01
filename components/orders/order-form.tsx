'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { CheckCircle2, PackagePlus } from 'lucide-react'
import { createOrder, type CreatedOrder, type OrderFormState } from '@/lib/orders/actions'
import type { AreaRoute } from '@/lib/orders/queries'
import { LocationPicker } from '@/components/map/location-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Overlay } from '@/components/ui/overlay'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { haversineKm } from '@/lib/geo/haversine'
import { codCollectable } from '@/lib/pricing'
import { formatMmk, formatDistanceKm, cn } from '@/lib/utils'
import { isInServiceArea } from '@/lib/geo/thingangyun'
import type { LatLng } from '@/types/domain'

export type OrderFormProps = {
  shop: { id: string; pickup_address: string; pickup_lat: number; pickup_lng: number }
  /** Deliverable areas WITH the route that prices each one. */
  areas: AreaRoute[]
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" block disabled={pending || disabled}>
      <PackagePlus />
      {pending ? 'Creating order…' : 'Create delivery order'}
    </Button>
  )
}

/**
 * Schema keys this form has somewhere to PUT an error message.
 *
 * orderCreateSchema validates keys that have no text input behind them —
 * pickupPoint, dropoffPoint, paymentMethod, feePayer, shopId, deliveryFee. An
 * error on one of those used to render nowhere: the page came back unchanged and
 * the shop's order looked like it had evaporated. Anything not in this set is
 * now collected into the alert at the top instead of being dropped.
 *
 * Add a key here only when the field genuinely renders `err(key)`.
 */
const RENDERED_ERROR_KEYS = new Set([
  'pickupAddress',
  'customerName',
  'customerPhone',
  'customerPhoneAlt',
  'dropoffAddress',
  'parcelDesc',
  'parcelWeightG',
  'parcelValue',
  'codAmount',
])

export function OrderForm({ shop, areas }: OrderFormProps) {
  const [state, action] = useActionState<OrderFormState, FormData>(createOrder, {})
  const err = (k: string) => state.fieldErrors?.[k]?.[0]

  // Point errors have no input of their own, so they ride on the address field
  // of the picker they belong to — which is where someone looking at a rejected
  // pin would expect to find them.
  const pickupError = err('pickupAddress') ?? err('pickupPoint')
  const dropoffError = err('dropoffAddress') ?? err('dropoffPoint')

  const unshown = Object.entries(state.fieldErrors ?? {}).filter(
    ([k]) => !RENDERED_ERROR_KEYS.has(k) && k !== 'pickupPoint' && k !== 'dropoffPoint',
  )

  // The form is three tall cards; the alert sits above all of them, so after a
  // failed submit it is usually scrolled off screen. Not scrolling to it is most
  // of why a rejected submission reads as "nothing happened".
  const alertRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (state.error || state.fieldErrors) {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [state])

  const [pickup, setPickup] = useState<LatLng>({
    lat: shop.pickup_lat,
    lng: shop.pickup_lng,
  })
  const [pickupAddress, setPickupAddress] = useState(shop.pickup_address)
  const [dropoff, setDropoff] = useState<LatLng | null>(null)
  const [dropoffAddress, setDropoffAddress] = useState('')

  const [areaId, setAreaId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'prepaid'>('cod')
  const [feePayer, setFeePayer] = useState<'customer' | 'shop'>('customer')
  const [goodsValue, setGoodsValue] = useState('')

  const formRef = useRef<HTMLFormElement>(null)

  /**
   * Which confirmation the shop has already dismissed.
   *
   * `useActionState` has no reset, so "Create another order" cannot clear the
   * returned state — it records the code instead. A later submit returns a
   * different code and the modal opens again on its own.
   */
  const [dismissedCode, setDismissedCode] = useState<string | null>(null)
  const created = state.created && state.created.code !== dismissedCode ? state.created : null

  const resetForForNextOrder = (order: CreatedOrder) => {
    setDismissedCode(order.code)
    formRef.current?.reset()
    // Controlled values are not touched by form.reset(), so they are cleared by
    // hand. Pickup stays: the next parcel leaves from the same shop.
    setDropoff(null)
    setDropoffAddress('')
    setGoodsValue('')
    setPaymentMethod('cod')
    setFeePayer('customer')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /**
   * The price is the route's flat fee, chosen by the destination area.
   *
   * Not distance any more. Distance quoting survived the route migration and was
   * charging a Mingaladon parcel 8,100 Ks against the official 4,000 — the fee
   * the shop pays and the cost the platform carries were computed off two
   * unrelated models. The server recomputes this from the same table on submit;
   * what is shown here is a preview, never the stored number.
   */
  const area = useMemo(() => areas.find((a) => a.areaId === areaId) ?? null, [areas, areaId])
  const fee = area?.fee ?? 0

  /** Informational only: a shop still likes to know how far the parcel goes. */
  const crowKm = useMemo(
    () => (dropoff ? haversineKm(pickup, dropoff) : null),
    [pickup, dropoff],
  )

  const goods = Number(goodsValue) || 0
  const codTotal = area && paymentMethod === 'cod' ? codCollectable(goods, fee, feePayer) : 0

  // Mirrors what the server will accept. Pickup is included because a shop whose
  // saved pickup point predates the geofence change would otherwise submit an
  // order the database rejects, with the failure landing on a field that has no
  // input of its own.
  const canSubmit =
    !!dropoff &&
    !!area &&
    isInServiceArea(dropoff) &&
    isInServiceArea(pickup) &&
    dropoffAddress.trim().length >= 5

  return (
    <>
      <form ref={formRef} action={action} className="space-y-6" noValidate>
      <div ref={alertRef}>
        {state.error || unshown.length > 0 ? (
          <Alert tone="error" title={state.error ?? 'Could not create this order'}>
            {unshown.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {unshown.map(([key, messages]) => (
                  <li key={key}>{messages[0]}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
      </div>

      <input type="hidden" name="paymentMethod" value={paymentMethod} />
      <input type="hidden" name="feePayer" value={feePayer} />

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · Pickup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocationPicker
            kind="pickup"
            label="Pickup point"
            point={pickup}
            address={pickupAddress}
            onPointChange={setPickup}
            onAddressChange={setPickupAddress}
            fieldPrefix="pickup"
            addressError={pickupError}
            addressPlaceholder="Shop address"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pickup contact" htmlFor="pickupContact" hint="Defaults to your shop phone">
              <Input id="pickupContact" name="pickupContact" placeholder="Ask for Ma Su" />
            </Field>
            <Field label="Pickup note" htmlFor="pickupNote">
              <Input id="pickupNote" name="pickupNote" placeholder="Green shutter, side lane" />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">2 · Customer &amp; delivery address</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer name" htmlFor="customerName" required error={err('customerName')}>
              <Input
                id="customerName"
                name="customerName"
                required
                aria-invalid={!!err('customerName')}
              />
            </Field>
            <Field
              label="Customer phone"
              htmlFor="customerPhone"
              required
              hint="09 791 234 567"
              error={err('customerPhone')}
            >
              <Input
                id="customerPhone"
                name="customerPhone"
                type="tel"
                inputMode="tel"
                placeholder="09 791 234 567"
                required
                aria-invalid={!!err('customerPhone')}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Alternate phone" htmlFor="customerPhoneAlt" error={err('customerPhoneAlt')}>
              <Input id="customerPhoneAlt" name="customerPhoneAlt" type="tel" inputMode="tel" />
            </Field>
            {/*
              Required, because it sets the price. Grouped by route so a shop can
              see which run their parcel joins, and each option carries its fee —
              the number is the point of the field, not a detail of it.
            */}
            <Field
              label="Destination area"
              htmlFor="dropoffAreaId"
              required
              hint="Sets the route and the delivery fee"
              error={err('dropoffAreaId')}
            >
              <Select
                id="dropoffAreaId"
                name="dropoffAreaId"
                value={areaId}
                onChange={(e) => setAreaId(e.target.value)}
                required
                aria-invalid={!!err('dropoffAreaId')}
              >
                <option value="">Choose an area…</option>
                {Object.entries(
                  areas.reduce<Record<string, AreaRoute[]>>((acc, a) => {
                    ;(acc[a.routeName] ??= []).push(a)
                    return acc
                  }, {}),
                ).map(([routeName, group]) => (
                  <optgroup key={routeName} label={routeName}>
                    {group.map((a) => (
                      <option key={a.areaId} value={a.areaId}>
                        {a.areaName}
                        {a.areaNameMm ? ` · ${a.areaNameMm}` : ''} — {formatMmk(a.fee)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
          </div>

          <LocationPicker
            kind="dropoff"
            label="Delivery point"
            point={dropoff}
            address={dropoffAddress}
            onPointChange={setDropoff}
            onAddressChange={setDropoffAddress}
            fieldPrefix="dropoff"
            addressError={dropoffError}
            addressPlaceholder="No. 7, Baho Street, Lhay Htaung Kan"
          />

          <Field label="Delivery note" htmlFor="dropoffNote" hint="Gate colour, floor, landmark">
            <Textarea
              id="dropoffNote"
              name="dropoffNote"
              rows={2}
              placeholder="Blue gate, 2nd floor, ring twice"
            />
          </Field>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">3 · Parcel &amp; payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="What is in the parcel?" htmlFor="parcelDesc" required error={err('parcelDesc')}>
            <Input
              id="parcelDesc"
              name="parcelDesc"
              required
              placeholder="2x instant coffee cartons"
              aria-invalid={!!err('parcelDesc')}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Weight (g)" htmlFor="parcelWeightG" error={err('parcelWeightG')}>
              <Input
                id="parcelWeightG"
                name="parcelWeightG"
                type="number"
                inputMode="numeric"
                min={0}
                max={50000}
              />
            </Field>
            <Field label="Declared value (Ks)" htmlFor="parcelValue" error={err('parcelValue')}>
              <Input id="parcelValue" name="parcelValue" type="number" inputMode="numeric" min={0} />
            </Field>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isFragile" className="size-4 accent-[var(--brand-red)]" />
                Fragile
              </label>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payment" htmlFor="paymentMethodSelect" required>
              <Select
                id="paymentMethodSelect"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as 'cod' | 'prepaid')}
              >
                <option value="cod">Cash on delivery</option>
                <option value="prepaid">Already paid (prepaid)</option>
              </Select>
            </Field>
            <Field label="Who pays the delivery fee?" htmlFor="feePayerSelect">
              <Select
                id="feePayerSelect"
                value={feePayer}
                onChange={(e) => setFeePayer(e.target.value as 'customer' | 'shop')}
              >
                <option value="customer">Customer pays on delivery</option>
                <option value="shop">Shop pays (deducted from me)</option>
              </Select>
            </Field>
          </div>

          {paymentMethod === 'cod' ? (
            <Field
              label="Goods value to collect (Ks)"
              htmlFor="goodsValue"
              required
              hint="Price of the goods only — the delivery fee is added automatically below"
              error={err('codAmount')}
            >
              <Input
                id="goodsValue"
                name="goodsValue"
                type="number"
                inputMode="numeric"
                min={1}
                value={goodsValue}
                onChange={(e) => setGoodsValue(e.target.value)}
                required
                aria-invalid={!!err('codAmount')}
              />
            </Field>
          ) : (
            <input type="hidden" name="goodsValue" value="0" />
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <QuoteSummary
        area={area}
        crowKm={crowKm}
        paymentMethod={paymentMethod}
        feePayer={feePayer}
        goods={goods}
        codTotal={codTotal}
        hasDropoff={!!dropoff}
      />

      <SubmitButton disabled={!canSubmit} />
      {!canSubmit ? (
        <p className="text-center text-xs text-muted-foreground">
          {!isInServiceArea(pickup)
            ? 'Your pickup point is outside the delivery area. Fix it in shop settings.'
            : 'Drop the delivery pin and enter the address to continue.'}
        </p>
      ) : null}
    </form>

      {created ? (
        <OrderCreatedDialog
          order={created}
          areas={areas}
          onCreateAnother={() => resetForForNextOrder(created)}
        />
      ) : null}
    </>
  )
}

/**
 * Shown once, immediately after the insert, before anyone navigates.
 *
 * Escape and the backdrop are wired to "create another", not to a bare close.
 * Dismissing therefore always lands somewhere coherent — a blank form ready for
 * the next parcel — rather than on a stale form still showing the order that was
 * just submitted, which invites creating it twice. The code is on the orders
 * list either way if it is dismissed before being written down.
 */
function OrderCreatedDialog({
  order,
  areas,
  onCreateAnother,
}: {
  order: CreatedOrder
  areas: OrderFormProps['areas']
  onCreateAnother: () => void
}) {
  const router = useRouter()
  const area = areas.find((a) => a.areaId === order.dropoffAreaId) ?? null
  const areaName = area?.areaName ?? null
  const isCod = order.paymentMethod === 'cod'

  return (
    <Overlay
      open
      side="center"
      title="Order created"
      onClose={onCreateAnother}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCreateAnother}>
            <PackagePlus />
            Create another order
          </Button>
          <Button onClick={() => router.push('/shop/orders')}>View orders</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-700" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-emerald-800">Order code — write this on the parcel</p>
            <p className="font-mono text-lg font-semibold tracking-tight text-emerald-900">
              {order.code}
            </p>
          </div>
        </div>

        <dl className="space-y-2 text-sm">
          <DetailRow label="Recipient">{order.customerName}</DetailRow>
          <DetailRow label="Destination">
            {areaName ? <span className="font-medium">{areaName}</span> : null}
            {areaName ? ' · ' : null}
            <span className="text-muted-foreground">{order.dropoffAddress}</span>
          </DetailRow>
          {area ? (
            <DetailRow label="Route">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: area.colour }}
                  aria-hidden="true"
                />
                {area.routeName}
              </span>
            </DetailRow>
          ) : null}
          <DetailRow label="Delivery fee">
            {formatMmk(order.deliveryFee)}
            <span className="text-muted-foreground">
              {' '}
              · paid by the {order.feePayer}
            </span>
          </DetailRow>
          <DetailRow label={isCod ? 'Rider collects' : 'Payment'}>
            {isCod ? (
              <span className="font-semibold">{formatMmk(order.codAmount)}</span>
            ) : (
              <span className="text-muted-foreground">Prepaid — nothing to collect</span>
            )}
          </DetailRow>
        </dl>

        <p className="text-xs text-muted-foreground">
          Dispatch can see it now. It stays in Open deliveries until a rider is assigned.
        </p>
      </div>
    </Overlay>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  )
}

function QuoteSummary({
  area,
  crowKm,
  paymentMethod,
  feePayer,
  goods,
  codTotal,
  hasDropoff,
}: {
  area: AreaRoute | null
  crowKm: number | null
  paymentMethod: 'cod' | 'prepaid'
  feePayer: 'customer' | 'shop'
  goods: number
  codTotal: number
  hasDropoff: boolean
}) {
  return (
    <Card className={cn('border-brand-gold/60 bg-brand-gold/5')}>
      <CardHeader>
        <CardTitle className="text-base">Delivery fee</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!area ? (
          <p className="text-muted-foreground">
            Choose the destination area to see the fee.
            {hasDropoff ? null : ' Then drop the delivery pin.'}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: area.colour }}
                aria-hidden="true"
              />
              <span className="font-medium">{area.routeName}</span>
            </div>
            <Row label="Destination" value={area.areaName} />
            {crowKm !== null ? (
              <Row label="Distance (straight line)" value={formatDistanceKm(crowKm)} />
            ) : null}
            <hr className="my-2" />
            {/*
              One line, because there is one number. The fee is flat per route —
              there is no base plus distance to break down any more.
            */}
            <Row label="Delivery fee" value={formatMmk(area.fee)} strong />

            {paymentMethod === 'cod' ? (
              <>
                <hr className="my-2" />
                <Row label="Goods value" value={formatMmk(goods)} />
                <Row
                  label={
                    feePayer === 'customer'
                      ? 'Rider collects from customer'
                      : 'Rider collects (fee billed to you)'
                  }
                  value={formatMmk(codTotal)}
                  strong
                />
              </>
            ) : null}
            <p className="pt-1 text-xs text-muted-foreground">
              Confirmed by the server when the order is created.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={cn('text-muted-foreground', strong && 'font-medium text-foreground')}>
        {label}
      </span>
      <span className={cn('tabular-nums', strong && 'font-semibold')}>{value}</span>
    </div>
  )
}
