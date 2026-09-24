'use client'

import { useActionState, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronDown, PackagePlus, Store } from 'lucide-react'
import { createOutsideOrder, type OutsideFormState } from '@/lib/admin/outside-way'
import {
  DIRECT_SHOP,
  OUTSIDE_CHANNELS,
  SOURCE_LABEL,
  outsidePayment,
  type OutsideChannel,
} from '@/lib/orders/outside-way'
import type { CustomerPaid } from '@/lib/orders/booking'
import type { AreaRoute } from '@/lib/orders/queries'
import { useLocale, useT } from '@/components/shared/i18n-provider'
import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn, formatMmk } from '@/lib/utils'
import { areaDisplayName, zoneGroupLabel } from '@/lib/orders/zone-label'

type ShopOption = {
  id: string
  name: string
  phone: string
  pickupAddress: string
  isActive: boolean
}

/**
 * The Outside Way booking form: one parcel, typed up from a chat or a call.
 *
 * SUBMITTED THROUGH `onSubmit`, NOT `action={}`. React resets an uncontrolled
 * form after a form action, and here a refused submit (a phone typo, a missing
 * township) would wipe a parcel the office copied field by field out of a
 * Viber thread. Dispatching the action by hand keeps every field on screen.
 *
 * The fee and the "rider collects" figure are previews. The server re-derives
 * both through the same `outsidePayment`, from the zone it looks up itself.
 *
 * LAID OUT LIKE THE SHOP'S BOOKING FORM (components/orders/order-form): where,
 * who, money, then "more details" folded away -- the same cards, sizes and
 * wording, so the office and the shops see one form. The admin-only parts sit
 * in their own card first: the channel, the shop or Direct sender, and pickup.
 *
 * NO WAY IS CHOSEN HERE, and no way name is shown. The office picks the way on
 * the Ways board (0049), so this form states that instead of offering one.
 */
export function OutsideWayForm({
  shops,
  areas,
}: {
  shops: ShopOption[]
  areas: AreaRoute[]
}) {
  const t = useT()
  const locale = useLocale()
  const [state, dispatch] = useActionState<OutsideFormState, FormData>(createOutsideOrder, {})
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  const [shopQuery, setShopQuery] = useState('')
  const [shopId, setShopId] = useState('')
  const [channel, setChannel] = useState<OutsideChannel>('telegram')
  const [areaId, setAreaId] = useState('')
  const [paid, setPaid] = useState<CustomerPaid>('nothing')
  const [goods, setGoods] = useState('')
  const [feePayer, setFeePayer] = useState<'customer' | 'shop'>('customer')
  // Null until the office types in it; until then it follows the zone price.
  const [feeEdit, setFeeEdit] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  const err = (k: string) => state.fieldErrors?.[k]?.[0]
  const direct = shopId === DIRECT_SHOP
  const shop = shops.find((s) => s.id === shopId) ?? null
  const area = areas.find((a) => a.areaId === areaId) ?? null
  const feeText = feeEdit ?? (area ? String(area.fee) : '')

  const visibleShops = useMemo(() => {
    const q = shopQuery.trim().toLowerCase()
    if (!q) return shops
    const digits = q.replace(/\D/g, '')
    return shops.filter(
      (s) => s.name.toLowerCase().includes(q) || (digits.length > 2 && s.phone.includes(digits)),
    )
  }, [shops, shopQuery])

  // Grouped by ZONE, as on the shop's booking form -- never by way (0049).
  const byZone = useMemo(() => {
    const groups = new Map<string, AreaRoute[]>()
    for (const a of [...areas].sort(
      (x, y) => x.zoneCode.localeCompare(y.zoneCode) || x.areaName.localeCompare(y.areaName),
    )) {
      groups.set(a.zoneCode, [...(groups.get(a.zoneCode) ?? []), a])
    }
    return [...groups.values()]
  }, [areas])

  const feeNumber = Number(feeText.replace(/[,\s]/g, ''))
  const preview =
    feeText.trim() !== '' && Number.isFinite(feeNumber)
      ? outsidePayment(paid, goods, feePayer, feeNumber)
      : null

  const created = state.created && state.created.code !== dismissed ? state.created : null

  const reset = () => {
    if (state.created) setDismissed(state.created.code)
    formRef.current?.reset()
    setShopQuery('')
    setShopId('')
    setChannel('telegram')
    setAreaId('')
    setPaid('nothing')
    setGoods('')
    setFeePayer('customer')
    setFeeEdit(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (created) {
    return (
      <Alert tone="success" title={t('ow.created', { code: created.code })}>
        <p>
          {t('ow.createdBody', {
            receiver: created.customerName,
            shop: created.shopName,
            collect: formatMmk(created.codAmount),
          })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/admin/orders/${created.id}`} className={buttonVariants({ size: 'sm' })}>
            {t('ow.open')}
          </Link>
          <Button type="button" size="sm" variant="outline" onClick={reset}>
            {t('ow.another')}
          </Button>
        </div>
      </Alert>
    )
  }

  return (
    <form
      ref={formRef}
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        startTransition(() => dispatch(data))
      }}
    >
      {state.error ? <Alert tone="error" title={state.error} /> : null}

      <input type="hidden" name="source" value={channel} />
      <input type="hidden" name="shop" value={shopId} />
      <input type="hidden" name="paid" value={paid} />
      <input type="hidden" name="feePayer" value={paid === 'nothing' ? feePayer : 'customer'} />
      {/* Chosen later on the Ways board, never here. */}
      <input type="hidden" name="routeId" value="" />

      {/* ---- 0. sender: the admin-only card ------------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Store className="size-4 text-muted-foreground" aria-hidden="true" />
            {t('ow.section.sender')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-medium">{t('ow.channel')}</legend>
            <div className="flex flex-wrap gap-2">
              {OUTSIDE_CHANNELS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={channel === c}
                  onClick={() => setChannel(c)}
                  className={cn(
                    'min-h-9 rounded-full border px-3 text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    channel === c
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {SOURCE_LABEL[c][locale]}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('ow.shopSearch')} htmlFor="shopQuery">
              <Input
                id="shopQuery"
                type="search"
                value={shopQuery}
                onChange={(e) => setShopQuery(e.target.value)}
                autoComplete="off"
                className="h-12 text-base"
              />
            </Field>
            <Field label={t('ow.shop')} htmlFor="shopSelect" required error={err('shop')}>
              <Select
                id="shopSelect"
                value={shopId}
                onChange={(e) => setShopId(e.target.value)}
                aria-invalid={!!err('shop')}
                className="h-12 text-base"
              >
                <option value="">{t('ow.shopPlaceholder')}</option>
                <option value={DIRECT_SHOP}>{t('ow.direct')}</option>
                {visibleShops.map((s) => (
                  <option key={s.id} value={s.id} disabled={!s.isActive}>
                    {s.name}
                    {s.isActive ? '' : ` (${t('ow.notTrading')})`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {direct ? (
            <>
              <p className="text-xs text-muted-foreground">{t('ow.directHint')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('ow.senderName')} htmlFor="senderName" required error={err('senderName')}>
                  <Input
                    id="senderName"
                    name="senderName"
                    aria-invalid={!!err('senderName')}
                    className="h-12 text-base"
                  />
                </Field>
                <Field label={t('ow.senderPhone')} htmlFor="senderPhone" required error={err('senderPhone')}>
                  <Input
                    id="senderPhone"
                    name="senderPhone"
                    type="tel"
                    inputMode="tel"
                    placeholder="09 791 234 567"
                    aria-invalid={!!err('senderPhone')}
                    className="h-12 text-base"
                  />
                </Field>
              </div>
            </>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t('ow.pickupAddress')}
              htmlFor="pickupAddress"
              required={direct}
              hint={direct ? undefined : t('ow.pickupAddressHint')}
              error={err('pickupAddress')}
            >
              <Input
                id="pickupAddress"
                name="pickupAddress"
                placeholder={shop?.pickupAddress}
                aria-invalid={!!err('pickupAddress')}
                className="h-12 text-base"
              />
            </Field>
            <Field label={t('ow.pickupContact')} htmlFor="pickupContact" error={err('pickupContact')}>
              <Input
                id="pickupContact"
                name="pickupContact"
                type="tel"
                inputMode="tel"
                placeholder={shop?.phone}
                className="h-12 text-base"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* ---- 1. where ---------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('book.where')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label={t('book.address')} htmlFor="dropoffAddress" required error={err('dropoffAddress')}>
            <Textarea
              id="dropoffAddress"
              name="dropoffAddress"
              rows={2}
              aria-invalid={!!err('dropoffAddress')}
              className="text-base"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Township and price only, grouped by zone -- as shops see it. */}
            <Field label={t('ow.township')} htmlFor="dropoffAreaId" required error={err('dropoffAreaId')}>
              <Select
                id="dropoffAreaId"
                name="dropoffAreaId"
                value={areaId}
                onChange={(e) => setAreaId(e.target.value)}
                aria-invalid={!!err('dropoffAreaId')}
                className="h-12 text-base"
              >
                <option value="">{t('ow.townshipPlaceholder')}</option>
                {byZone.map((group) => (
                  <optgroup key={group[0]!.zoneCode} label={zoneGroupLabel(group[0]!, locale)}>
                    {group.map((a) => (
                      <option key={a.areaId} value={a.areaId}>
                        {areaDisplayName(a, locale)} — {formatMmk(a.fee)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>

            {/*
              STATED, NOT CHOSEN. The way is the office's decision on the Ways
              board, and showing way names here only invited choosing one from
              a form that cannot see the day's runs.
            */}
            <Field label={t('ow.route')} htmlFor="routeLater" hint={t('ow.routeLaterHint')}>
              <Select id="routeLater" value="" disabled className="h-12 text-base">
                <option value="">{t('ow.routeLater')}</option>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* ---- 2. who ------------------------------------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('book.who')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('book.name')} htmlFor="customerName" required error={err('customerName')}>
              <Input
                id="customerName"
                name="customerName"
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
                aria-invalid={!!err('customerPhone')}
                className="h-12 text-base"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* ---- 3. money ---------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('book.money')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">{t('book.paidQuestion')}</legend>
            {(
              [
                // The shop's own words for the first two; the third is the
                // office's, because the shop's says "deduct it from me".
                ['nothing', 'book.paidNothing'],
                ['product', 'book.paidProduct'],
                ['all', 'ow.paid.all'],
              ] as const
            ).map(([value, key]) => (
              <label
                key={value}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-lg border bg-muted/30 px-3 text-base',
                  paid === value && 'border-primary bg-primary/5 font-medium',
                )}
              >
                <input
                  type="radio"
                  name="paidChoice"
                  value={value}
                  checked={paid === value}
                  onChange={() => {
                    setPaid(value)
                    if (value !== 'nothing') setGoods('')
                  }}
                  className="size-5 accent-brand-red"
                />
                {t(key)}
              </label>
            ))}
            {err('paid') ? <p className="text-xs font-medium text-destructive">{err('paid')}</p> : null}
          </fieldset>

          {paid === 'nothing' ? (
            <Field label={t('ow.cod')} htmlFor="goodsValue" required error={err('goodsValue')}>
              <Input
                id="goodsValue"
                name="goodsValue"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={goods}
                onChange={(e) => setGoods(e.target.value)}
                aria-invalid={!!err('goodsValue')}
                className="h-14 text-xl font-semibold tabular-nums"
              />
            </Field>
          ) : null}

          {paid === 'all' ? (
            <p className="text-sm text-muted-foreground">{t('book.prepaidNote')}</p>
          ) : paid === 'product' ? (
            <p className="text-sm text-muted-foreground">{t('book.paidProductNote')}</p>
          ) : null}

          {/* The office's own: the fee, prefilled from the zone and editable. */}
          <Field
            label={t('ow.fee')}
            htmlFor="deliveryFee"
            hint={area ? t('ow.feeHint', { fee: formatMmk(area.fee) }) : t('ow.feeHintNone')}
            error={err('deliveryFee')}
          >
            <Input
              id="deliveryFee"
              name="deliveryFee"
              inputMode="numeric"
              value={feeText}
              onChange={(e) => setFeeEdit(e.target.value)}
              aria-invalid={!!err('deliveryFee')}
              className="h-12 text-base tabular-nums"
            />
          </Field>

          {/* Same shape as the shop form's quote box. */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-gold/60 bg-brand-gold/5 p-3 text-sm">
            <span className="font-medium">{t('ow.collect')}</span>
            <span className="text-lg font-semibold tabular-nums">
              {preview?.ok ? formatMmk(preview.collect) : '—'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ---- everything else, closed ------------------------------------- */}
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
            <Input id="parcelDesc" name="parcelDesc" />
          </Field>

          <Field
            label={t('book.deliveryNote')}
            htmlFor="dropoffNote"
            hint={t('book.deliveryNoteHint')}
            error={err('dropoffNote')}
          >
            <Textarea id="dropoffNote" name="dropoffNote" rows={2} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('book.altPhone')} htmlFor="customerPhoneAlt" error={err('customerPhoneAlt')}>
              <Input id="customerPhoneAlt" name="customerPhoneAlt" type="tel" inputMode="tel" />
            </Field>
            {paid === 'nothing' ? (
              <Field label={t('book.feePayer')} htmlFor="feePayerSelect">
                <Select
                  id="feePayerSelect"
                  value={feePayer}
                  onChange={(e) => setFeePayer(e.target.value as 'customer' | 'shop')}
                >
                  <option value="customer">{t('ow.feePayer.customer')}</option>
                  <option value="shop">{t('ow.feePayer.shop')}</option>
                </Select>
              </Field>
            ) : null}
          </div>
        </div>
      </details>

      <Button type="submit" block size="lg" disabled={pending}>
        <PackagePlus />
        {pending ? t('ow.submitting') : t('ow.submit')}
      </Button>
    </form>
  )
}
