'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { LocateFixed, Store } from 'lucide-react'
import { setUpShop, type ShopSetupResult } from '@/lib/shops/actions'
import { Card, CardContent } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import type { LatLng } from '@/types/domain'

/**
 * Five fields, all of them typed, and none of them a map.
 *
 * Name and phone come from the sign-up and are prefilled rather than asked
 * again. "What you sell" is clause 1 of the COD advance policy -- the office
 * needs it to verify a shop, and asking now costs a line where asking later
 * costs a second conversation.
 *
 * THE ADDRESS IS PLAIN TEXT. It used to be `LocationPicker`: search-as-you-type
 * suggestions over a collapsible map with a draggable pin, 595 lines of it, on
 * the first screen a merchant ever sees. They know their own address. They type
 * it.
 *
 * NOTHING ON THIS FORM CAN REFUSE A SUBMISSION. It could, until 0034: the
 * coordinates were NOT NULL behind a geofence CHECK, so a merchant whose street
 * the geocoder has never heard of was turned away on the first screen. Of six
 * realistic Yangon addresses Nominatim found two, so that was the common case.
 * A missing pin is now a legal state and Save always works.
 *
 * WHICH LEAVES THE BUTTON, and it still matters -- a merchant setting up their
 * shop is STANDING IN IT. One tap gives a pin more accurate than any address
 * lookup, with no map to pan and nothing to search. Skip it and the server
 * geocodes the typed address; if that also comes back empty the shop is created
 * with no pin, and the dashboard asks for one before the first parcel. Three
 * outcomes, none of them a dead end.
 *
 * So the button is presented as the good path rather than a required one, and
 * nothing about it blocks Save.
 */
export function ShopSetupForm({
  defaultName,
  defaultPhone,
}: {
  defaultName: string
  defaultPhone: string
}) {
  const [state, action] = useActionState<ShopSetupResult, FormData>(setUpShop, { ok: false })
  const err = (k: string) => (state.ok ? undefined : state.fieldErrors?.[k]?.[0])

  const [point, setPoint] = useState<LatLng | null>(null)

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <form action={action} className="space-y-4" noValidate>
          {!state.ok && state.message ? <Alert tone="error">{state.message}</Alert> : null}

          <Field label="Shop name" htmlFor="name" required error={err('name')}>
            <Input id="name" name="name" defaultValue={defaultName} autoComplete="organization" />
          </Field>

          <Field
            label="What do you sell?"
            htmlFor="goodsType"
            required
            error={err('goodsType')}
            hint="Clothes, phone accessories, cosmetics, food…"
          >
            <Input id="goodsType" name="goodsType" placeholder="Clothes and bags" />
          </Field>

          <Field label="Shop phone" htmlFor="phone" required error={err('phone')}>
            <Input
              id="phone"
              name="phone"
              inputMode="tel"
              defaultValue={defaultPhone}
              autoComplete="tel"
            />
          </Field>

          <Field
            label="Where should riders collect from?"
            htmlFor="pickupAddress"
            required
            error={err('pickupAddress')}
            hint="Street, ward and township."
          >
            <Input
              id="pickupAddress"
              name="pickupAddress"
              autoComplete="street-address"
              placeholder="No. 24, Thitsar Road, San Pya Ward, Thingangyun"
            />
          </Field>

          {/* Directly under the address, because it is the same question a
              second time: not where the shop is, but how to recognise it. */}
          <Field
            label="Pickup notes for riders"
            htmlFor="pickupNote"
            error={err('pickupNote')}
            hint="A landmark, the shutter colour, who to ask for. Optional."
          >
            <Input
              id="pickupNote"
              name="pickupNote"
              placeholder="Near the big mall, green shutter. Ask for Ma Su."
            />
          </Field>

          <PinButton point={point} onPoint={setPoint} />

          <SubmitButton />

          <p className="text-xs text-muted-foreground">
            You can book prepaid parcels straight away. Cash on delivery opens once the Mingalar
            Express office has had a look at your shop.
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * One tap, no map.
 *
 * `getCurrentPosition` prompts the browser's own permission dialog, so there is
 * nothing to explain up front and no state to render before the answer. A
 * refusal or a failure is NOT a blocker -- the address still gets geocoded
 * server-side -- so it reports quietly and the form stays submittable. The
 * alternative, blocking Save on a pin, would put a browser permission dialog in
 * front of shop registration.
 */
function PinButton({
  point,
  onPoint,
}: {
  point: LatLng | null
  onPoint: (p: LatLng) => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  function locate() {
    if (!('geolocation' in navigator)) {
      setProblem('This phone cannot share its location. Type the address and we will find it.')
      return
    }
    setBusy(true)
    setProblem(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setBusy(false)
      },
      () => {
        setBusy(false)
        setProblem(
          'We could not read your location. Type the address instead and we will look it up.',
        )
      },
      // A shop is a fixed address, so a cached fix from a few minutes ago is
      // just as good and answers instantly. `enableHighAccuracy` would spin up
      // GPS indoors and often time out.
      { timeout: 10_000, maximumAge: 300_000 },
    )
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      {/*
        The hidden pair is what the server reads. Empty when no tap happened,
        which `setupSchema` treats as absent and falls back to geocoding.
      */}
      <input type="hidden" name="pickupLat" value={point?.lat ?? ''} />
      <input type="hidden" name="pickupLng" value={point?.lng ?? ''} />

      {point ? (
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-500">
          Location saved. Riders will be sent here.
        </p>
      ) : (
        <>
          <Button type="button" variant="outline" size="touch" block onClick={locate} disabled={busy}>
            <LocateFixed />
            {busy ? 'Getting your location…' : 'Use my current location'}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Tap this while you are at the shop and riders will find it first time. Skip it and we
            will look up the address you typed &mdash; you can set the exact spot later in Shop
            settings.
          </p>
        </>
      )}

      {problem ? <p className="mt-2 text-xs text-destructive">{problem}</p> : null}
    </div>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="touch" block disabled={pending}>
      <Store />
      {pending ? 'Saving…' : 'Save'}
    </Button>
  )
}
