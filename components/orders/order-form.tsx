'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { CheckCircle2, ChevronDown, MapPin, PackagePlus, Printer, Store } from 'lucide-react'
import Link from 'next/link'
import { createOrder, type CreatedOrder, type OrderFormState } from '@/lib/orders/actions'
import type { AreaRoute } from '@/lib/orders/queries'
import { LocationPicker } from '@/components/map/location-picker'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Overlay } from '@/components/ui/overlay'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { bookingBlocker, bookingPayment, parseAmount } from '@/lib/orders/booking'
import { matchAreaFromAddress } from '@/lib/orders/area-match'
import type { ReusedCustomer } from '@/lib/orders/customer-lookup'
import { CustomerLookup } from '@/components/orders/customer-lookup'
import { codCollectable } from '@/lib/pricing'
import { formatMmk, cn } from '@/lib/utils'
import { isInServiceArea } from '@/lib/geo/thingangyun'
import type { MessageKey } from '@/lib/i18n'
import { useLocale, useT } from '@/components/shared/i18n-provider'
import type { LatLng } from '@/types/domain'

export type OrderFormProps = {
  shop: { id: string; pickup_address: string; pickup_lat: number; pickup_lng: number }
  /** Deliverable areas WITH the route that prices each one. */
  areas: AreaRoute[]
}

/**
 * Booking a parcel: FOUR FIELDS AND A PIN.
 *
 * It was fourteen inputs across three numbered cards, and a shop books parcels
 * standing at a counter between customers. What survived is what the parcel
 * cannot exist without:
 *
 *   the pin        where it goes, which fills the address by reverse geocode
 *   the area       which route it joins, and therefore the fee
 *   name + phone   who to hand it to
 *   the amount     what to collect — 0 means already paid
 *
 * WHAT WENT, AND WHERE.
 *
 *   the payment select   deleted. "Amount to collect" answers it: any figure is
 *                        COD, zero is prepaid. Two inputs that could contradict
 *                        each other became one that cannot.
 *   "what is inside"     optional, in More details. Nothing prices or routes on
 *                        it, and `Fragile` — which does change handling — is its
 *                        own flag. See parcelDesc in lib/validation/schemas.
 *   the pickup card      a whole card, with a map, asking a shop where its own
 *                        shop is. Now one line and hidden fields carrying the
 *                        saved location.
 *   the rest             alt phone, note, weight, declared value, fragile, fee
 *                        payer — behind one disclosure, closed by default.
 *
 * CAPABILITY DELIBERATELY REMOVED: the pickup point can no longer be moved per
 * parcel. It is the shop's saved location and it changes in shop settings. That
 * also sidesteps a real hazard — a Leaflet map inside a closed <details> has
 * zero size and renders grey until something resizes it.
 */

function SubmitButton({ disabled }: { disabled: boolean }) {
  const t = useT()
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="touch"
      block
      disabled={pending || disabled}
      className="text-base font-bold"
    >
      <PackagePlus />
      {pending ? t('book.submitting') : t('book.submit')}
    </Button>
  )
}

/**
 * Schema keys this form has somewhere to PUT an error message.
 *
 * orderCreateSchema validates keys with no text input behind them —
 * pickupPoint, dropoffPoint, paymentMethod, feePayer, shopId, deliveryFee. An
 * error on one of those used to render nowhere: the page came back unchanged
 * and the shop's order looked like it had evaporated. Anything not in this set
 * is collected into the alert at the top instead of being dropped.
 *
 * Add a key here only when the field genuinely renders `err(key)`.
 */
const RENDERED_ERROR_KEYS = new Set([
  // NOT pickupAddress. It had an input when there was a pickup card; now it is a
  // hidden field carrying the shop's saved address, so listing it here would
  // swallow the error — a shop whose saved address is under 5 characters would
  // submit, be rejected, and see nothing change. That is the exact failure this
  // set exists to prevent, reintroduced by deleting the card.
  'customerName',
  'customerPhone',
  'customerPhoneAlt',
  'dropoffAddress',
  'dropoffAreaId',
  'parcelDesc',
  'parcelWeightG',
  'parcelValue',
  'codAmount',
])

export function OrderForm({ shop, areas }: OrderFormProps) {
  const locale = useLocale()
  const t = useT()
  const [state, action] = useActionState<OrderFormState, FormData>(createOrder, {})
  const err = (k: string) => state.fieldErrors?.[k]?.[0]

  // Point errors have no input of their own, so they ride on the address field
  // of the picker they belong to — where someone looking at a rejected pin would
  // expect to find them.
  const dropoffError = err('dropoffAddress') ?? err('dropoffPoint')

  const unshown = Object.entries(state.fieldErrors ?? {}).filter(
    ([k]) => !RENDERED_ERROR_KEYS.has(k) && k !== 'pickupPoint' && k !== 'dropoffPoint',
  )

  // The alert sits above the cards, so after a failed submit it is usually
  // scrolled off screen. Not scrolling to it is most of why a rejected
  // submission reads as "nothing happened".
  const alertRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (state.error || state.fieldErrors) {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [state])

  const [dropoff, setDropoff] = useState<LatLng | null>(null)
  const [dropoffAddress, setDropoffAddress] = useState('')
  const [areaId, setAreaId] = useState('')
  /**
   * Set once the shop picks an area BY HAND.
   *
   * Until then the address drives the dropdown; after it, their choice stands
   * and the address can only warn. Reset with `resetSeq` on "Book another" —
   * the LocationPicker's `addressTouched` taught that lesson: a ref that
   * survives a reset silently changes behaviour from the second parcel on.
   */
  const areaTouched = useRef(false)
  const [feePayer, setFeePayer] = useState<'customer' | 'shop'>('customer')
  const [collect, setCollect] = useState('')
  /** Prepaid is this tick and only this tick — never an inferred empty field. */
  const [prepaid, setPrepaid] = useState(false)

  /**
   * Bumped on "Book another", and used as the picker's `key`.
   *
   * `LocationPicker` decides whether to auto-fill the address from the pin using
   * a ref initialised once at mount (`addressTouched`). Clearing the address
   * state does not reset that ref, so once a shop had corrected an address —
   * which the hint text invites — the pin stopped auto-filling for every later
   * parcel in the session. Remounting is one line and cannot fall out of step
   * with the picker's internals the way a reset handle would.
   */
  const [resetSeq, setResetSeq] = useState(0)

  const formRef = useRef<HTMLFormElement>(null)
  const pickup: LatLng = { lat: shop.pickup_lat, lng: shop.pickup_lng }

  /** Set when the customer half was filled from a past parcel, cleared on reset. */
  const [reused, setReused] = useState(false)

  /**
   * Fill the whole customer half from a parcel this shop has sent before.
   *
   * The COORDINATE is the real prize. `dropoff_lat/lng` are NOT NULL behind a
   * geofence CHECK, so every booking needs a point; a reused one is somewhere a
   * rider has actually delivered, which beats a geocode guess and beats a
   * township centroid the seed itself flags as VERIFY-CENTROID.
   *
   * Name and phone are uncontrolled inputs, so they are written straight into
   * the DOM node rather than mirrored into state — the same reason
   * `formRef.current?.reset()` is what clears them.
   */
  const applyCustomer = (c: ReusedCustomer) => {
    const form = formRef.current
    if (form) {
      const set = (name: string, value: string) => {
        const el = form.elements.namedItem(name)
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = value
      }
      set('customerName', c.name)
      set('customerPhone', c.phone)
      set('customerPhoneAlt', c.phoneAlt)
      set('dropoffNote', c.note)
    }

    setDropoffAddress(c.address)
    setDropoff(c.point)
    setAreaId(c.areaId)
    // Their past choice stands: the address matcher may only warn from here,
    // not silently re-pick.
    areaTouched.current = true
    setReused(true)
    // Remount the picker so it initialises with the address already present —
    // otherwise `addressTouched` stays false and the next pin nudge would
    // overwrite an address the shop deliberately reused.
    setResetSeq((n) => n + 1)
  }

  /**
   * Which confirmation the shop has already dismissed.
   *
   * `useActionState` has no reset, so "Book another" cannot clear the returned
   * state — it records the code instead. A later submit returns a different code
   * and the modal opens again on its own.
   */
  const [dismissedCode, setDismissedCode] = useState<string | null>(null)
  const created = state.created && state.created.code !== dismissedCode ? state.created : null

  const resetForNextOrder = (order: CreatedOrder) => {
    setDismissedCode(order.code)
    formRef.current?.reset()
    // Controlled values survive form.reset(), so they are cleared by hand.
    setDropoff(null)
    setDropoffAddress('')
    setAreaId('')
    areaTouched.current = false
    setReused(false)
    setCollect('')
    setPrepaid(false)
    setFeePayer('customer')
    // Remounts LocationPicker so the pin auto-fills the address again.
    setResetSeq((n) => n + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /**
   * The price is the route's flat fee, chosen by the destination area.
   *
   * Not distance. Distance quoting survived the route migration and charged a
   * Mingaladon parcel 8,100 Ks against the official 4,000. The server recomputes
   * this from the same table on submit; what is shown here is a preview, never
   * the stored number.
   */
  const area = useMemo(() => areas.find((a) => a.areaId === areaId) ?? null, [areas, areaId])
  const fee = area?.fee ?? 0

  /**
   * The area, read out of the address the shop already typed.
   *
   * Three of nine live orders had an area contradicting their own address — one
   * undercharged, all three routed onto the wrong run. See lib/orders/area-match
   * for why the address text beats measuring the pin against area centroids.
   */
  const match = useMemo(
    () => matchAreaFromAddress(dropoffAddress, areas, areaId || null),
    [dropoffAddress, areas, areaId],
  )
  const suggested = useMemo(
    () => areas.find((a) => a.areaId === match.suggestedId) ?? null,
    [areas, match.suggestedId],
  )

  // Fill the dropdown from the address until the shop overrides it. This is the
  // speed half of the fix: for a geocoded address the 24-item list never has to
  // be opened at all.
  useEffect(() => {
    if (areaTouched.current) return
    if (match.suggestedId && match.suggestedId !== areaId) setAreaId(match.suggestedId)
  }, [match.suggestedId, areaId])

  const autoFilled = !areaTouched.current && !!areaId && areaId === match.suggestedId

  /**
   * The amount, parsed once and used for everything: the preview, the gate and
   * the posted value. It used to be sanitised for display only while the raw
   * string was posted, so `45000.5` previewed a total the server then rejected,
   * and `-5` previewed as "prepaid, nothing to collect" before erroring.
   */
  const amount = useMemo(() => parseAmount(collect), [collect])
  const { paymentMethod, goodsValue, feePayer: postedFeePayer } = bookingPayment(
    prepaid,
    amount,
    feePayer,
  )
  const codTotal =
    area && paymentMethod === 'cod' ? codCollectable(goodsValue, fee, postedFeePayer) : 0

  // The gate lives in lib/orders/booking so a missing clause is a failing test
  // rather than an invisible boolean — see the note at the top of that file.
  const pickupOutside = !isInServiceArea(pickup)
  const blocker = bookingBlocker({
    hasPin: !!dropoff,
    pinInServiceArea: !!dropoff && isInServiceArea(dropoff),
    pickupInServiceArea: !pickupOutside,
    addressLength: dropoffAddress.trim().length,
    hasArea: !!area,
    prepaid,
    amount,
  })
  const canSubmit = blocker === null

  const BLOCKER_MESSAGE: Record<NonNullable<typeof blocker>, MessageKey> = {
    pickup_outside: 'book.pickupOutside',
    no_pin: 'book.needPin',
    pin_outside: 'book.pinOutside',
    no_address: 'book.needAddress',
    no_area: 'book.needArea',
    amount_empty: 'book.needAmount',
    amount_decimal: 'book.amtDecimal',
    amount_negative: 'book.amtNegative',
    amount_not_a_number: 'book.amtNotNumber',
    amount_too_large: 'book.amtTooLarge',
  }

  // Shown under the amount rather than under the button when it IS the amount:
  // an error about a figure belongs beside the figure.
  const amountProblem =
    blocker && blocker.startsWith('amount_') && collect.trim().length > 0
      ? t(BLOCKER_MESSAGE[blocker])
      : undefined

  const byRoute = useMemo(
    () =>
      Object.entries(
        areas.reduce<Record<string, AreaRoute[]>>((acc, a) => {
          ;(acc[a.routeName] ??= []).push(a)
          return acc
        }, {}),
      ),
    [areas],
  )

  return (
    <>
      <form ref={formRef} action={action} className="space-y-4" noValidate>
        <div ref={alertRef}>
          {state.error || unshown.length > 0 ? (
            <Alert tone="error" title={state.error ?? t('book.failed')}>
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

        {/* All three come from bookingPayment, so what posts is exactly what the
            quote above the button showed — including feePayer, which is forced
            to `shop` on a prepaid parcel because cod_by_shop bills the shop
            regardless of what this column says. */}
        <input type="hidden" name="paymentMethod" value={paymentMethod} />
        <input type="hidden" name="feePayer" value={postedFeePayer} />
        {/* The shop's own saved location. Changed in shop settings, not here. */}
        <input type="hidden" name="pickupAddress" value={shop.pickup_address} />
        <input type="hidden" name="pickupLat" value={shop.pickup_lat} />
        <input type="hidden" name="pickupLng" value={shop.pickup_lng} />

        {pickupOutside ? (
          <Alert tone="warning">{t('book.pickupOutside')}</Alert>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Store className="size-3.5 shrink-0" aria-hidden="true" />
            {t('book.pickupFrom')}: {shop.pickup_address}
            <Link href="/shop/settings" className="text-primary hover:underline">
              {t('shop.nav.settings')}
            </Link>
          </p>
        )}

        {/* ---- 1. where ------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="size-4 shrink-0 text-brand-gold" aria-hidden="true" />
              {t('book.where')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <LocationPicker
              // Remounted on "Book another" so the pin auto-fills again. See
              // `resetSeq` above.
              key={`dropoff-${resetSeq}`}
              kind="dropoff"
              label={t('book.address')}
              point={dropoff}
              address={dropoffAddress}
              onPointChange={setDropoff}
              onAddressChange={setDropoffAddress}
              fieldPrefix="dropoff"
              addressError={dropoffError}
              addressPlaceholder="No. 7, Baho Street"
            />

            {/* Required: it selects the route, and the route sets the fee. Each
                option carries its own price, because the number is the point of
                the field rather than a detail of it. */}
            <Field
              label={t('book.area')}
              htmlFor="dropoffAreaId"
              required
              hint={t('book.areaHint')}
              error={err('dropoffAreaId')}
            >
              <Select
                id="dropoffAreaId"
                name="dropoffAreaId"
                value={areaId}
                onChange={(e) => {
                  areaTouched.current = true
                  setAreaId(e.target.value)
                }}
                required
                aria-invalid={!!err('dropoffAreaId')}
                className="h-12 text-base"
              >
                <option value="">{t('book.areaChoose')}</option>
                {byRoute.map(([routeName, group]) => (
                  <optgroup key={routeName} label={routeName}>
                    {group.map((a) => (
                      <option key={a.areaId} value={a.areaId}>
                        {locale === 'my' && a.areaNameMm ? a.areaNameMm : a.areaName} —{' '}
                        {formatMmk(a.fee)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>

            {/* WARN, NEVER BLOCK. The rule is a heuristic — an address can
                legitimately mention a neighbour ("near Bahan market, Yankin") —
                so the shop always keeps the final say. */}
            {match.contradicts && suggested ? (
              <Alert tone="warning">
                <p>
                  {t('book.areaDisagrees', {
                    area: locale === 'my' && suggested.areaNameMm ? suggested.areaNameMm : suggested.areaName,
                    chosen: locale === 'my' && area?.areaNameMm ? area.areaNameMm : (area?.areaName ?? ''),
                  })}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    areaTouched.current = true
                    setAreaId(suggested.areaId)
                  }}
                >
                  {t('book.areaUse', {
                    area: locale === 'my' && suggested.areaNameMm ? suggested.areaNameMm : suggested.areaName,
                    fee: formatMmk(suggested.fee),
                  })}
                </Button>
              </Alert>
            ) : autoFilled ? (
              <p className="text-xs text-muted-foreground">{t('book.areaFromAddress')}</p>
            ) : null}
          </CardContent>
        </Card>

        {/* ---- 2. who --------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('book.who')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* One tap fills name, phone, address, area AND the exact point the
                rider went to last time. */}
            <CustomerLookup onPick={applyCustomer} />

            {reused ? (
              <p className="text-xs text-muted-foreground">{t('book.reused')}</p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('book.name')}
                htmlFor="customerName"
                required
                error={err('customerName')}
              >
                <Input
                  id="customerName"
                  name="customerName"
                  required
                  autoComplete="off"
                  aria-invalid={!!err('customerName')}
                  className="h-12 text-base"
                />
              </Field>
              <Field
                label={t('book.phone')}
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
                  className="h-12 text-base"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* ---- 3. money ------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('book.money')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field
              label={t('book.collect')}
              htmlFor="goodsValue"
              hint={prepaid ? undefined : t('book.collectHint')}
              error={err('codAmount') ?? amountProblem}
            >
              {/*
                `type="text"` with a numeric keypad, not `type="number"`. The
                form is noValidate so `min` never fired anyway, and a text field
                lets `parseAmount` name the problem — "whole kyat only" — instead
                of the browser silently swallowing the keystroke or the server
                rejecting it after a round trip.

                No `placeholder="0"`: an empty box that reads 0 looks filled in,
                which is how a COD parcel used to get booked as prepaid.
              */}
              <Input
                id="goodsValue"
                name="goodsValue"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                disabled={prepaid}
                value={prepaid ? '' : collect}
                onChange={(e) => setCollect(e.target.value)}
                aria-invalid={!!(err('codAmount') ?? amountProblem)}
                className="h-14 text-xl font-semibold tabular-nums"
              />
            </Field>

            {/* The ONLY way to book a parcel with nothing to collect. Leaving
                the amount blank is now a blocked submit, not a silent prepaid. */}
            <label className="flex min-h-11 items-center gap-3 rounded-lg border bg-muted/30 px-3 text-base font-medium">
              <input
                type="checkbox"
                checked={prepaid}
                onChange={(e) => {
                  setPrepaid(e.target.checked)
                  if (e.target.checked) setCollect('')
                }}
                className="size-5 accent-brand-red"
              />
              {t('book.alreadyPaid')}
            </label>

            {prepaid ? (
              <p className="text-sm text-muted-foreground">{t('book.prepaidNote')}</p>
            ) : null}

            <QuoteSummary
              area={area}
              paymentMethod={paymentMethod}
              feePayer={postedFeePayer}
              goods={goodsValue}
              codTotal={codTotal}
            />
          </CardContent>
        </Card>

        {/* ---- everything else, closed ---------------------------------- */}
        <details className="group rounded-lg border bg-card">
          <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-medium">
            <span>
              {t('book.more')}{' '}
              <span className="font-normal text-muted-foreground">({t('book.moreHint')})</span>
            </span>
            <ChevronDown
              className="size-4 shrink-0 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>

          <div className="space-y-3 border-t p-4">
            <Field label={t('book.contents')} htmlFor="parcelDesc" error={err('parcelDesc')}>
              <Input id="parcelDesc" name="parcelDesc" placeholder="2x instant coffee cartons" />
            </Field>

            <Field
              label={t('book.deliveryNote')}
              htmlFor="dropoffNote"
              hint={t('book.deliveryNoteHint')}
            >
              <Textarea
                id="dropoffNote"
                name="dropoffNote"
                rows={2}
                placeholder="Blue gate, 2nd floor, ring twice"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('book.altPhone')}
                htmlFor="customerPhoneAlt"
                error={err('customerPhoneAlt')}
              >
                <Input id="customerPhoneAlt" name="customerPhoneAlt" type="tel" inputMode="tel" />
              </Field>
              {/* Hidden on a prepaid parcel, where it does nothing: cod_by_shop
                  bills the shop the delivery fee on ANY non-COD order and never
                  reads fee_payer. Leaving it enabled offered a choice the
                  database ignores. */}
              {prepaid ? null : (
                <Field label={t('book.feePayer')} htmlFor="feePayerSelect">
                  <Select
                    id="feePayerSelect"
                    value={feePayer}
                    onChange={(e) => setFeePayer(e.target.value as 'customer' | 'shop')}
                  >
                    <option value="customer">{t('book.feeCustomer')}</option>
                    <option value="shop">{t('book.feeShop')}</option>
                  </Select>
                </Field>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('book.weight')} htmlFor="parcelWeightG" error={err('parcelWeightG')}>
                <Input
                  id="parcelWeightG"
                  name="parcelWeightG"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={50000}
                />
              </Field>
              <Field label={t('book.declared')} htmlFor="parcelValue" error={err('parcelValue')}>
                <Input
                  id="parcelValue"
                  name="parcelValue"
                  type="number"
                  inputMode="numeric"
                  min={0}
                />
              </Field>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="isFragile"
                    className="size-4 accent-brand-red"
                  />
                  {t('book.fragile')}
                </label>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('book.pickupContact')} htmlFor="pickupContact">
                <Input id="pickupContact" name="pickupContact" placeholder="Ask for Ma Su" />
              </Field>
              <Field label={t('book.pickupNote')} htmlFor="pickupNote">
                <Input id="pickupNote" name="pickupNote" placeholder="Green shutter, side lane" />
              </Field>
            </div>
          </div>
        </details>

        <SubmitButton disabled={!canSubmit} />
        {/* The actual reason, not a generic one. It used to say "drop the pin
            and choose the area" whatever was wrong — including when the real
            problem was a missing amount, the case that booked a COD parcel as
            prepaid. `pickup_outside` already has its own banner at the top, and
            an amount problem is shown beside the amount. */}
        {blocker && blocker !== 'pickup_outside' && !amountProblem ? (
          <p className="text-center text-sm text-muted-foreground">
            {t(BLOCKER_MESSAGE[blocker])}
          </p>
        ) : null}
      </form>

      {created ? (
        <OrderCreatedDialog
          order={created}
          areas={areas}
          onCreateAnother={() => resetForNextOrder(created)}
        />
      ) : null}
    </>
  )
}

/**
 * Three buttons in a 512px modal, labelled in Burmese.
 *
 * `size="touch"` is a FIXED h-14 with no wrapping, and "လိပ်စာစာရွက်
 * ပရင့်ထုတ်ရန်" beside two more labels does not fit that row -- the text
 * clipped or forced the row wider than the panel. So the height is a floor
 * rather than a fixed value and the label may take a second line: 48px still
 * clears the tap-target minimum, and the footer wraps instead of overflowing
 * whatever a translation turns out to be. Tuning the button to the string is
 * the wrong way round.
 *
 * `w-full sm:w-auto` because these are stacked on a phone and inline on a
 * desktop. A bare `w-full` -- which is what shipped first -- makes a flex-row
 * item claim the whole row, which is why the print button looked like the
 * primary action even as an outline.
 *
 * Applied to the print ANCHOR directly rather than to a Button nested inside
 * it: `<a>` may not contain interactive content, and the repo already styles
 * links as buttons this way everywhere else.
 */
const FOOTER_BTN =
  'h-auto min-h-12 w-full whitespace-normal px-4 py-2.5 text-sm leading-snug sm:w-auto'

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
  const locale = useLocale()
  const t = useT()
  const router = useRouter()
  const area = areas.find((a) => a.areaId === order.dropoffAreaId) ?? null
  const areaName = area ? (locale === 'my' && area.areaNameMm ? area.areaNameMm : area.areaName) : null
  const isCod = order.paymentMethod === 'cod'

  return (
    <Overlay
      open
      side="center"
      title={t('created.title')}
      onClose={onCreateAnother}
      footer={
        /*
          Left to right: look at them, print one, book the next -- ending on the
          only filled control, which is the one thing a shop does over and over.
          Printing is a utility beside that, so it is an outline.

          `flex-col-reverse` on a phone is what puts the primary at the TOP of
          the stack while keeping that reading order in the markup.
        */
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <Button variant="ghost" className={FOOTER_BTN} onClick={() => router.push('/shop/orders')}>
            {t('created.viewOrders')}
          </Button>
          {/*
            A PLAIN ANCHOR, deliberately. `window.open` from a handler can be
            caught by a popup blocker; a real link with target=_blank never is.
            It also cannot call onCreateAnother -- and it must not: the doc
            comment above says Escape and the backdrop both mean "create
            another", so the dialog has to stay open BEHIND the new tab or the
            code leaves the screen at the exact moment it is being labelled.
          */}
          <a
            href={`/shop/orders/labels?ids=${order.id}&print=1`}
            target="_blank"
            rel="noopener"
            className={cn(buttonVariants({ variant: 'outline' }), FOOTER_BTN)}
          >
            <Printer className="size-4" />
            {t('created.print')}
          </a>
          <Button className={FOOTER_BTN} onClick={onCreateAnother}>
            <PackagePlus />
            {t('created.another')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-700" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-emerald-800">{t('created.writeCode')}</p>
            <p className="font-mono text-xl font-bold tracking-tight text-emerald-900">
              {order.code}
            </p>
          </div>
        </div>

        <dl className="space-y-2 text-sm">
          <DetailRow label={t('book.who')}>{order.customerName}</DetailRow>
          <DetailRow label={t('book.where')}>
            {areaName ? <span className="font-medium">{areaName}</span> : null}
            {areaName ? ' · ' : null}
            <span className="text-muted-foreground">{order.dropoffAddress}</span>
          </DetailRow>
          {area ? (
            <DetailRow label={t('quote.route')}>
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
          <DetailRow label={t('quote.fee')}>
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

/**
 * The fee, and what the rider will collect. Inline in the money card now, not a
 * fourth full-width card of its own.
 *
 * The distance line went with it: the fee is flat per route, so a straight-line
 * kilometre figure was a number that looked like it explained the price and did
 * not.
 */
function QuoteSummary({
  area,
  paymentMethod,
  feePayer,
  goods,
  codTotal,
}: {
  area: AreaRoute | null
  paymentMethod: 'cod' | 'prepaid'
  feePayer: 'customer' | 'shop'
  goods: number
  codTotal: number
}) {
  const locale = useLocale()
  const t = useT()
  if (!area) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        {t('quote.pickArea')}
      </p>
    )
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-brand-gold/60 bg-brand-gold/5 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: area.colour }}
          aria-hidden="true"
        />
        <span className="font-medium">
          {locale === 'my' && area.areaNameMm ? area.areaNameMm : area.areaName}
        </span>
        <span className="truncate text-xs text-muted-foreground">{area.routeName}</span>
      </div>

      {paymentMethod === 'cod' ? <Row label={t('quote.goods')} value={formatMmk(goods)} /> : null}
      <Row
        label={t('quote.fee')}
        value={formatMmk(area.fee)}
        hint={feePayer === 'shop' ? t('quote.feeOnYou') : undefined}
      />

      {paymentMethod === 'cod' ? (
        <>
          <hr className="my-1.5 border-brand-gold/40" />
          {/* The number the rider will actually ask for. Largest thing here,
              because it is the one a shop double-checks. */}
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{t('quote.total')}</span>
            <span className="text-xl font-bold tabular-nums">{formatMmk(codTotal)}</span>
          </div>
        </>
      ) : null}
    </div>
  )
}

function Row({
  label,
  value,
  hint,
  strong,
}: {
  label: string
  value: string
  hint?: string
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={cn('text-muted-foreground', strong && 'font-medium text-foreground')}>
        {label}
        {hint ? <span className="ml-1 text-xs">({hint})</span> : null}
      </span>
      <span className={cn('tabular-nums', strong && 'font-semibold')}>{value}</span>
    </div>
  )
}
