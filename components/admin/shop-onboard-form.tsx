'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Check, Copy, Store } from 'lucide-react'
import { onboardShop, type ShopActionResult } from '@/lib/admin/shop-actions'
import type { LatLng, ServiceArea } from '@/types/domain'
import { LocationPicker } from '@/components/map/location-picker'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { formatMyanmarPhone } from '@/lib/utils'

export type UnattachedOwner = { id: string; fullName: string; phone: string | null }

function SubmitButton({ mode }: { mode: 'new' | 'existing' }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      <Store />
      {pending
        ? 'Registering…'
        : mode === 'existing'
          ? 'Register shop for this owner'
          : 'Create account and shop'}
    </Button>
  )
}

/**
 * Manual shop registration.
 *
 * Two modes, because two different things can be missing. Public signup creates
 * the auth user and the profile but never a `shops` row — that is the "pending
 * setup" state `/shop/settings` tells owners to ring the office about, and it
 * needs a shop attached to the account they already have, not a duplicate.
 */
export function ShopOnboardForm({
  open,
  onClose,
  areas,
  owners,
  presetOwnerId,
  onDone,
}: {
  open: boolean
  onClose: () => void
  areas: ServiceArea[]
  owners: UnattachedOwner[]
  presetOwnerId: string | null
  onDone: (result: ShopActionResult) => void
}) {
  const [state, action] = useActionState<ShopActionResult, FormData>(onboardShop, {
    ok: false,
    message: '',
  })
  const err = (k: string) => (state.ok ? undefined : state.fieldErrors?.[k]?.[0])

  const [mode, setMode] = useState<'new' | 'existing'>(presetOwnerId ? 'existing' : 'new')
  const [credential, setCredential] = useState<'password' | 'invite'>('password')
  const [point, setPoint] = useState<LatLng | null>(null)
  const [address, setAddress] = useState('')
  const [copied, setCopied] = useState(false)

  const seen = useRef<ShopActionResult | null>(null)
  useEffect(() => {
    if (state === seen.current || !state.message) return
    seen.current = state
    onDone(state)
    // An invite link is shown once and must stay on screen to be copied, so a
    // successful invite deliberately does NOT close the drawer.
    if (state.ok && !state.inviteLink) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    if (presetOwnerId) setMode('existing')
  }, [presetOwnerId])

  if (!open) return null

  return (
    <Overlay
      open
      onClose={onClose}
      title="Register a shop"
      description="Walk-in registration — create the login and the shop together. An owner who signed up online is confirmed from their row instead."
    >
      {state.ok && state.inviteLink ? (
        <div className="space-y-3">
          <Alert tone="success">{state.message}</Alert>
          <Field
            label="One-time sign-in link"
            htmlFor="invite"
            hint="Shown once. Send it to the owner — it signs them in and lets them set a password."
          >
            <div className="flex gap-2">
              <Input id="invite" readOnly value={state.inviteLink} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  navigator.clipboard?.writeText(state.inviteLink ?? '').then(
                    () => setCopied(true),
                    () => setCopied(false),
                  )
                }}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </Field>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <form action={action} className="space-y-4" noValidate>
          <input type="hidden" name="ownerMode" value={mode} />

          {state.message && !state.ok ? <Alert tone="error">{state.message}</Alert> : null}
          {state.ok && state.warning ? <Alert tone="error">{state.warning}</Alert> : null}

          {/* -------------------------------------------------------------- */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Owner</legend>
            <div className="flex flex-wrap gap-2">
              <ModeButton
                active={mode === 'new'}
                onClick={() => setMode('new')}
                label="New account"
                hint="Walk-in — create the login too"
              />
              <ModeButton
                active={mode === 'existing'}
                onClick={() => setMode('existing')}
                label="Existing owner"
                hint={`${owners.length} awaiting setup`}
                disabled={owners.length === 0}
              />
            </div>
          </fieldset>

          {mode === 'existing' ? (
            <Field label="Owner account" htmlFor="ownerId" required error={err('ownerId')}>
              <Select
                id="ownerId"
                name="ownerId"
                defaultValue={presetOwnerId ?? ''}
                required
                key={presetOwnerId ?? 'none'}
              >
                <option value="">Select the owner…</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.fullName}
                    {o.phone ? ` — ${formatMyanmarPhone(o.phone)}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Owner name" htmlFor="ownerName" required error={err('ownerName')}>
                <Input id="ownerName" name="ownerName" required />
              </Field>

              <Field label="Owner email" htmlFor="ownerEmail" required error={err('ownerEmail')}>
                <Input
                  id="ownerEmail"
                  name="ownerEmail"
                  type="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </Field>

              <Field
                label="Owner mobile"
                htmlFor="ownerPhone"
                hint="Optional, but must be unique."
                error={err('ownerPhone')}
              >
                <Input
                  id="ownerPhone"
                  name="ownerPhone"
                  type="tel"
                  inputMode="tel"
                  placeholder="09 791 234 567"
                />
              </Field>

              <Field label="Sign-in method" htmlFor="credential">
                <Select
                  id="credential"
                  name="credential"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value as 'password' | 'invite')}
                >
                  <option value="password">Set an initial password</option>
                  <option value="invite">Generate a one-time link</option>
                </Select>
              </Field>

              {credential === 'password' ? (
                <Field
                  label="Initial password"
                  htmlFor="password"
                  required
                  hint="At least 8 characters. Hand it over in person."
                  error={err('password')}
                >
                  <Input id="password" name="password" type="text" autoComplete="off" required />
                </Field>
              ) : (
                <input type="hidden" name="password" value="" />
              )}
            </div>
          )}

          {/* -------------------------------------------------------------- */}
          <fieldset className="space-y-3 border-t pt-4">
            <legend className="text-sm font-semibold">Shop</legend>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Shop name" htmlFor="name" required error={err('name')}>
                <Input id="name" name="name" required />
              </Field>

              <Field label="Shop phone" htmlFor="phone" required error={err('phone')}>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="09 791 234 567"
                  required
                />
              </Field>

              <Field label="Ward" htmlFor="areaId" error={err('areaId')}>
                <Select id="areaId" name="areaId" defaultValue="">
                  <option value="">No ward</option>
                  {areas
                    .filter((a) => a.is_active)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </Select>
              </Field>

              <Field label="Pickup note" htmlFor="pickupNote" error={err('pickupNote')}>
                <Textarea
                  id="pickupNote"
                  name="pickupNote"
                  placeholder="Blue shutter, ask for Ma Thida"
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
              addressError={err('pickupAddress')}
              pointError={err('pickupPoint')}
              addressPlaceholder="No. 12, Thitsar Road"
            />
            {!point ? (
              <p className="text-xs text-muted-foreground">
                Drop a pin on the shop&rsquo;s door. It must be inside Greater Yangon — the
                database rejects anything outside the geofence.
              </p>
            ) : null}
          </fieldset>

          <div className="flex gap-2">
            <SubmitButton mode={mode} />
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Overlay>
  )
}

function ModeButton({
  active,
  onClick,
  label,
  hint,
  disabled,
}: {
  active: boolean
  onClick: () => void
  label: string
  hint: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? 'border-primary bg-primary/5' : 'hover:bg-muted'
      }`}
    >
      <span className="block font-medium">{label}</span>
      <span className="block text-xs text-muted-foreground">{hint}</span>
    </button>
  )
}
