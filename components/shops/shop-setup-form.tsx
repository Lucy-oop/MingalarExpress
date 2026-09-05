'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Store } from 'lucide-react'
import { setUpShop, type ShopSetupResult } from '@/lib/shops/actions'
import { LocationPicker } from '@/components/map/location-picker'
import { Card, CardContent } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import type { LatLng } from '@/types/domain'

/**
 * Four fields, and the address is the only one that takes any thought.
 *
 * Name and phone come from the sign-up and are prefilled rather than asked
 * again. "What you sell" is clause 1 of the COD advance policy -- the office
 * needs it to verify a shop, and asking now costs a line where asking later
 * costs a second conversation.
 *
 * THE MAP IS NOT A STEP. `LocationPicker` is address-first: typing offers
 * suggestions, choosing one sets the pin, and the map stays collapsed. An owner
 * who never opens it still produces coordinates, because the server geocodes
 * what they typed. The pin is there for the case OSM does not know the place.
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
  const [address, setAddress] = useState('')

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

          {/* The address a rider will read. Suggestions set the pin behind it. */}
          <LocationPicker
            kind="pickup"
            label="Where should riders collect from?"
            point={point}
            address={address}
            onPointChange={setPoint}
            onAddressChange={setAddress}
            fieldPrefix="pickup"
            addressError={err('pickupAddress')}
            addressPlaceholder="No. 24, Thitsar Road, San Pya Ward, Thingangyun"
          />

          <SubmitButton />

          <p className="text-xs text-muted-foreground">
            The Mingalar Express office checks new shops before the first parcel. You will be able
            to book as soon as it is confirmed.
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="touch" block disabled={pending}>
      <Store />
      {pending ? 'Saving…' : 'Send for confirmation'}
    </Button>
  )
}
