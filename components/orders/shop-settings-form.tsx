'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Save } from 'lucide-react'
import { updateShopSettings, type ShopSettingsState } from '@/lib/orders/actions'
import { LocationPicker } from '@/components/map/location-picker'
import { useT } from '@/components/shared/i18n-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isInServiceArea } from '@/lib/geo/thingangyun'
import type { LatLng } from '@/types/domain'

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || disabled}>
      <Save />
      {pending ? 'Saving…' : 'Save shop details'}
    </Button>
  )
}

/**
 * A shop editing its own record.
 *
 * `shops_owner_all` has permitted this since migration 0003 — the page was
 * read-only anyway, so changing a phone number meant telephoning the office.
 *
 * The pickup point matters more than it looks: it pre-fills every new order, so
 * a shop that moves and cannot update it starts sending riders to the old
 * address on every parcel.
 */
export function ShopSettingsForm({
  shop,
}: {
  shop: {
    name: string
    phone: string
    pickup_address: string
    /**
     * Null when nobody has established it yet (0034). A shop registers on its
     * address alone when the geocoder cannot place it, and THIS FORM is the
     * screen that fixes that -- so a null pin is the state it most needs to
     * handle well, not an edge case.
     */
    pickup_lat: number | null
    pickup_lng: number | null
    pickup_note: string | null
  }
}) {
  const t = useT()
  const [state, action] = useActionState<ShopSettingsState, FormData>(updateShopSettings, {})
  const err = (k: string) => state.fieldErrors?.[k]?.[0]

  const [point, setPoint] = useState<LatLng | null>(
    shop.pickup_lat === null || shop.pickup_lng === null
      ? null
      : { lat: shop.pickup_lat, lng: shop.pickup_lng },
  )
  const [address, setAddress] = useState(shop.pickup_address)
  const [saved, setSaved] = useState(false)

  // A success alert that never clears reads as "still saving" on the next edit.
  useEffect(() => {
    if (!state.ok) return
    setSaved(true)
    const id = setTimeout(() => setSaved(false), 4000)
    return () => clearTimeout(id)
  }, [state])

  /*
    ONE REASON SAVE IS BLOCKED, not two.

    HAVING NO PIN IS NO LONGER ONE OF THEM. It used to be: `pickupPoint` was
    required, so a shop with no map coordinates could not save its name, its
    phone or its pickup notes either, and the form said so in red. That is the
    wrong place for that block -- 0034 made the columns nullable precisely so a
    merchant whose street the geocoder cannot find is not turned away, and the
    thing a pin is actually needed for is BOOKING, where `orders.pickup_lat` is
    NOT NULL and the booking page explains it with the fix one tap away.

    A pin that IS set and lands outside Greater Yangon is a different matter.
    That is a mistake the owner just made and can immediately correct, and the
    database will refuse it anyway (`shops_pickup_in_service_area`), so catching
    it here turns a 23514 into a sentence.
  */
  const outOfArea = point !== null && !isInServiceArea(point)

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {saved ? <Alert tone="success">Shop details saved.</Alert> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your shop</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shop name" htmlFor="name" required error={err('name')}>
              <Input
                id="name"
                name="name"
                defaultValue={shop.name}
                required
                aria-invalid={!!err('name')}
              />
            </Field>

            <Field
              label="Shop phone"
              htmlFor="phone"
              required
              hint="09 791 234 567"
              error={err('phone')}
            >
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                defaultValue={shop.phone}
                required
                aria-invalid={!!err('phone')}
              />
            </Field>
          </div>

          <LocationPicker
            kind="pickup"
            label="Pickup point"
            point={point}
            address={address}
            onPointChange={setPoint}
            onAddressChange={setAddress}
            fieldPrefix="pickup"
            addressError={err('pickupAddress') ?? err('pickupPoint')}
            addressPlaceholder="Shop address"
          />

          {/*
            NEUTRAL, AND ONLY WHEN THERE IS NO PIN. Not a warning and not a
            blocker -- the address alone saves fine. It is here because the
            booking page sends people to this screen with "Set my pickup
            location", and arriving to find nothing about a pin would leave
            them looking for a control nobody named.
          */}
          {point === null ? (
            <p className="text-xs text-muted-foreground">{t('ss.pinOptional')}</p>
          ) : null}

          <Field
            label="Pickup note for riders"
            htmlFor="pickupNote"
            hint="Landmark, shutter colour, who to ask for"
            error={err('pickupNote')}
          >
            <Textarea
              id="pickupNote"
              name="pickupNote"
              rows={2}
              defaultValue={shop.pickup_note ?? ''}
              placeholder="Green shutter next to the tea shop. Ask for Ma Su."
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <SaveButton disabled={outOfArea} />
        {outOfArea ? (
          <p className="text-xs text-destructive">{t('ss.outOfArea')}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{t('ss.addressHint')}</p>
        )}
      </div>
    </form>
  )
}
