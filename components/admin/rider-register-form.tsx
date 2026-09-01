'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { UserPlus } from 'lucide-react'
import { registerRider, type AdminResult } from '@/lib/admin/actions'
import type { ServiceArea } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function SubmitButton({ held }: { held: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      <UserPlus />
      {pending ? 'Creating account…' : held ? 'Register for approval' : 'Register and approve'}
    </Button>
  )
}

export function RiderRegisterForm({
  areas,
  defaultCoverageKm,
}: {
  areas: ServiceArea[]
  defaultCoverageKm: number
}) {
  const [state, action] = useActionState<AdminResult, FormData>(registerRider, {
    ok: false,
    message: '',
  })
  const [open, setOpen] = useState(false)
  const [held, setHeld] = useState(true)
  const formRef = useRef<HTMLFormElement>(null)
  const err = (k: string) => (state.ok ? undefined : state.fieldErrors?.[k]?.[0])

  // Clear the form after a successful registration; leaving the previous
  // rider's NRC and plate in the fields is how a second rider gets the first
  // one's details.
  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state])

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setOpen(true)}>
          <UserPlus />
          Register a rider
        </Button>
        {state.ok && state.message ? (
          <span className="text-sm text-emerald-700">{state.message}</span>
        ) : null}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Register a rider</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={action} className="space-y-4" noValidate>
          {state.message ? (
            <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Full name" htmlFor="fullName" required error={err('fullName')}>
              <Input id="fullName" name="fullName" required aria-invalid={!!err('fullName')} />
            </Field>

            <Field label="Email" htmlFor="email" required error={err('email')}>
              <Input
                id="email"
                name="email"
                type="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                aria-invalid={!!err('email')}
              />
            </Field>

            <Field
              label="Mobile"
              htmlFor="phone"
              required
              hint="e.g. 09 791 234 567"
              error={err('phone')}
            >
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                placeholder="09 791 234 567"
                required
                aria-invalid={!!err('phone')}
              />
            </Field>

            <Field
              label="Temporary password"
              htmlFor="password"
              required
              hint="At least 8 characters. Give it to the rider in person."
              error={err('password')}
            >
              <Input
                id="password"
                name="password"
                type="text"
                autoComplete="off"
                required
                aria-invalid={!!err('password')}
              />
            </Field>

            <Field label="Base ward" htmlFor="baseAreaId" error={err('baseAreaId')}>
              <Select id="baseAreaId" name="baseAreaId" defaultValue="">
                <option value="">No base ward</option>
                {areas
                  .filter((a) => a.is_active)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            </Field>

            <Field
              label="Coverage radius (km)"
              htmlFor="coverageKm"
              required
              hint="0.5 – 30. Riders may narrow this themselves, never widen it."
              error={err('coverageKm')}
            >
              <Input
                id="coverageKm"
                name="coverageKm"
                type="number"
                step="0.5"
                min="0.5"
                max="30"
                defaultValue={defaultCoverageKm}
                required
                aria-invalid={!!err('coverageKm')}
              />
            </Field>

            <Field
              label="Max parcels at once"
              htmlFor="maxActiveOrders"
              required
              error={err('maxActiveOrders')}
            >
              <Input
                id="maxActiveOrders"
                name="maxActiveOrders"
                type="number"
                min="1"
                max="10"
                defaultValue={3}
                required
                aria-invalid={!!err('maxActiveOrders')}
              />
            </Field>

            <Field
              label="COD float limit (Ks)"
              htmlFor="codFloatLimit"
              required
              hint="Dispatch stops offering COD work above this."
              error={err('codFloatLimit')}
            >
              <Input
                id="codFloatLimit"
                name="codFloatLimit"
                type="number"
                min="0"
                step="1000"
                defaultValue={500000}
                required
                aria-invalid={!!err('codFloatLimit')}
              />
            </Field>

            <Field label="Vehicle plate" htmlFor="vehiclePlate" error={err('vehiclePlate')}>
              <Input id="vehiclePlate" name="vehiclePlate" placeholder="9J/1234" />
            </Field>

            <Field
              label="NRC number"
              htmlFor="nrcNo"
              hint="Kept for identification. Super Admin only."
              error={err('nrcNo')}
            >
              <Input id="nrcNo" name="nrcNo" />
            </Field>
          </div>

          <label className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
            <input
              type="checkbox"
              name="holdForApproval"
              className="mt-0.5 size-4"
              checked={held}
              onChange={(e) => setHeld(e.target.checked)}
            />
            <span>
              <span className="font-medium">Hold for approval</span>
              <span className="block text-xs text-muted-foreground">
                The account is created but cannot sign in until you approve it on the roster. Leave
                this on until the NRC and plate have been checked in person.
              </span>
            </span>
          </label>

          <div className="flex gap-2">
            <SubmitButton held={held} />
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
