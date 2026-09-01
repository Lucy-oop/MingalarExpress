'use client'

import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { PackagePlus } from 'lucide-react'
import { createOrder, type OrderFormState } from '@/lib/orders/actions'
import { LocationPicker } from '@/components/map/location-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { haversineKm, etaMinutes } from '@/lib/geo/haversine'
import { quoteFee, codCollectable, type FeeQuote } from '@/lib/pricing'
import { formatMmk, formatDistanceKm, cn } from '@/lib/utils'
import { isInServiceArea } from '@/lib/geo/thingangyun'
import type { AppSettings, LatLng, ServiceArea } from '@/types/domain'

type PricingSettings = Pick<
  AppSettings,
  'base_delivery_fee' | 'per_km_fee' | 'free_km' | 'road_factor' | 'rider_commission_pct'
>

export type OrderFormProps = {
  shop: { id: string; pickup_address: string; pickup_lat: number; pickup_lng: number }
  areas: Pick<ServiceArea, 'id' | 'name' | 'name_mm'>[]
  settings: PricingSettings
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

export function OrderForm({ shop, areas, settings }: OrderFormProps) {
  const [state, action] = useActionState<OrderFormState, FormData>(createOrder, {})
  const err = (k: string) => state.fieldErrors?.[k]?.[0]

  const [pickup, setPickup] = useState<LatLng>({
    lat: shop.pickup_lat,
    lng: shop.pickup_lng,
  })
  const [pickupAddress, setPickupAddress] = useState(shop.pickup_address)
  const [dropoff, setDropoff] = useState<LatLng | null>(null)
  const [dropoffAddress, setDropoffAddress] = useState('')

  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'prepaid'>('cod')
  const [feePayer, setFeePayer] = useState<'customer' | 'shop'>('customer')
  const [goodsValue, setGoodsValue] = useState('')

  /**
   * The quote is computed locally for instant feedback and confirmed by the
   * server on submit. Same `quoteFee` function on both sides, same settings row,
   * so the number the shop sees is the number that gets written -- but the
   * server's copy is the one that counts.
   */
  const quote: FeeQuote | null = useMemo(() => {
    if (!dropoff || !isInServiceArea(dropoff)) return null
    return quoteFee(haversineKm(pickup, dropoff), settings)
  }, [pickup, dropoff, settings])

  const goods = Number(goodsValue) || 0
  const codTotal = quote && paymentMethod === 'cod' ? codCollectable(goods, quote.total, feePayer) : 0

  const canSubmit = !!dropoff && isInServiceArea(dropoff) && dropoffAddress.trim().length >= 5

  return (
    <form action={action} className="space-y-6" noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

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
            addressError={err('pickupAddress')}
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
            <Field label="Ward" htmlFor="dropoffAreaId" hint="Helps dispatch pick the nearest rider">
              <Select id="dropoffAreaId" name="dropoffAreaId" defaultValue="">
                <option value="">Select a ward…</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.name_mm ? ` · ${a.name_mm}` : ''}
                  </option>
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
            addressError={err('dropoffAddress')}
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
        quote={quote}
        paymentMethod={paymentMethod}
        feePayer={feePayer}
        goods={goods}
        codTotal={codTotal}
        hasDropoff={!!dropoff}
      />

      <SubmitButton disabled={!canSubmit} />
      {!canSubmit ? (
        <p className="text-center text-xs text-muted-foreground">
          Drop the delivery pin and enter the address to continue.
        </p>
      ) : null}
    </form>
  )
}

function QuoteSummary({
  quote,
  paymentMethod,
  feePayer,
  goods,
  codTotal,
  hasDropoff,
}: {
  quote: FeeQuote | null
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
        {!quote ? (
          <p className="text-muted-foreground">
            {hasDropoff
              ? 'Move the pin inside Thingangyun to see the fee.'
              : 'Drop the delivery pin to calculate the fee.'}
          </p>
        ) : (
          <>
            <Row label="Distance (straight line)" value={formatDistanceKm(quote.crowKm)} />
            <Row label="By road (estimated)" value={formatDistanceKm(quote.roadKm)} />
            <Row label="Estimated ride time" value={`${etaMinutes(quote.crowKm)} min`} />
            <hr className="my-2" />
            <Row label="Base fee" value={formatMmk(quote.baseFee)} />
            <Row
              label={`Distance charge (${quote.billableKm.toFixed(1)} km billable)`}
              value={formatMmk(quote.distanceFee)}
            />
            <Row label="Delivery fee" value={formatMmk(quote.total)} strong />

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
