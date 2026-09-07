'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Check, ChevronDown, Store, UserRound } from 'lucide-react'
import { onboardShop, type ShopActionResult } from '@/lib/admin/shop-actions'
import { LocationPicker } from '@/components/map/location-picker'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { formatMyanmarPhone } from '@/lib/utils'
import type { ServiceArea, LatLng } from '@/types/domain'

/**
 * Confirming a shop for an owner who signed up online.
 *
 * WHAT THIS REPLACES. The row's action opened the full registration drawer,
 * whose Owner dropdown already printed the owner's name and phone in the option
 * text -- and then asked for Shop name and Shop phone as empty required fields.
 * The details were on screen and the office retyped them.
 *
 * WHY IT IS NOT ONE CLICK, which is worth stating rather than pretending:
 * `shops.pickup_address` is NOT NULL, and signup collects only name, email,
 * phone and password. Nobody has ever asked the owner where to collect from, so
 * somebody has to supply it. One field is the honest floor, and the
 * address-first picker makes it one field and a tap.
 *
 * The PIN is no longer part of that floor -- 0034 made `pickup_lat/lng`
 * nullable so a merchant registering themselves is never turned away by a
 * geocoder that has not heard of their street. The office may leave it unset
 * here too; the shop simply cannot book a parcel until somebody places it, and
 * both the merchant's dashboard and the shop list say so.
 *
 * Name and phone are prefilled but stay editable behind a disclosure: a shop's
 * counter line is often not the owner's mobile, and the signup field is labelled
 * "Shop or owner name", so it is sometimes a person's name rather than a shop's.
 *
 * There is no separate approval to perform. `shops.is_active` defaults to true
 * and is never written on insert -- creating the row IS the approval, which is
 * why the button says Confirm and not Approve.
 *
 * Posts to the same `onboardShop` action as the full form, with
 * `ownerMode=existing`, so validation, the audit row and the RLS path are
 * unchanged.
 */
export function ShopConfirmDialog({
  open,
  onClose,
  owner,
  areas,
  onDone,
}: {
  open: boolean
  onClose: () => void
  owner: { id: string; fullName: string; phone: string | null } | null
  areas: ServiceArea[]
  onDone: (result: ShopActionResult) => void
}) {
  const [state, action] = useActionState<ShopActionResult, FormData>(onboardShop, {
    ok: false,
    message: '',
  })
  const err = (k: string) => (state.ok ? undefined : state.fieldErrors?.[k]?.[0])

  const [point, setPoint] = useState<LatLng | null>(null)
  const [address, setAddress] = useState('')
  const [editIdentity, setEditIdentity] = useState(false)

  const seen = useRef<ShopActionResult | null>(null)
  useEffect(() => {
    if (state === seen.current || !state.message) return
    seen.current = state
    onDone(state)
    if (state.ok) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // Each owner gets a clean sheet; a pin left from the last confirmation would
  // silently put a second shop on the first one's doorstep.
  useEffect(() => {
    setPoint(null)
    setAddress('')
    setEditIdentity(false)
  }, [owner?.id])

  if (!open || !owner) return null

  return (
    <Overlay
      open
      onClose={onClose}
      title="Confirm shop"
      description="Finish setup for an owner who signed up online."
    >
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="ownerMode" value="existing" />
        <input type="hidden" name="ownerId" value={owner.id} />

        {state.message && !state.ok ? <Alert tone="error">{state.message}</Alert> : null}

        {/* What they already told us. Facts, not inputs. */}
        <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {owner.fullName}
          </p>
          {owner.phone ? (
            <p className="pl-6 font-mono text-muted-foreground">
              {formatMyanmarPhone(owner.phone)}
            </p>
          ) : null}
          <p className="pl-6 text-xs text-muted-foreground">From their sign-up.</p>
        </div>

        {/*
          Prefilled and posted whether or not the disclosure is open — an
          untouched confirmation must still carry a name and a phone.
        */}
        {editIdentity ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Shop name" htmlFor="name" required error={err('name')}>
              <Input id="name" name="name" defaultValue={owner.fullName} />
            </Field>
            <Field label="Shop phone" htmlFor="phone" required error={err('phone')}>
              <Input id="phone" name="phone" defaultValue={owner.phone ?? ''} />
            </Field>
          </div>
        ) : (
          <>
            <input type="hidden" name="name" value={owner.fullName} />
            <input type="hidden" name="phone" value={owner.phone ?? ''} />
            <button
              type="button"
              onClick={() => setEditIdentity(true)}
              className="flex items-center gap-1 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className="size-3.5" aria-hidden="true" />
              The shop trades under a different name or number
            </button>
            {/* A rejected name or phone would otherwise be invisible, because
                the field carrying it is a hidden input. */}
            {err('name') || err('phone') ? (
              <p className="text-xs font-medium text-destructive">
                {err('name') ?? err('phone')} — open the details above to fix it.
              </p>
            ) : null}
          </>
        )}

        {/* The one thing nobody has asked the owner for. */}
        <LocationPicker
          kind="pickup"
          label="Where do riders collect from?"
          point={point}
          address={address}
          onPointChange={setPoint}
          onAddressChange={setAddress}
          fieldPrefix="pickup"
          addressError={err('pickupAddress')}
          pointError={err('pickupPoint')}
          addressPlaceholder="No. 12, Thitsar Road"
        />

        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">Ward and collection note</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Ward" htmlFor="areaId" error={err('areaId')}>
              <Select id="areaId" name="areaId" defaultValue="">
                <option value="">No ward</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note for the rider" htmlFor="pickupNote" error={err('pickupNote')}>
              <Input
                id="pickupNote"
                name="pickupNote"
                placeholder="Blue shutter, ask for Ma Thida"
              />
            </Field>
          </div>
        </details>

        <div className="flex gap-2">
          <ConfirmButton />
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Overlay>
  )
}

function ConfirmButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Store /> : <Check />}
      {pending ? 'Confirming…' : 'Confirm shop'}
    </Button>
  )
}
