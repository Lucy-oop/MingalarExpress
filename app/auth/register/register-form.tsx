'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Store } from 'lucide-react'
import { signUpShop, type AuthFormState } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" block disabled={pending}>
      <Store />
      {pending ? 'Creating account…' : 'Create shop account'}
    </Button>
  )
}

export function RegisterForm() {
  const [state, action] = useActionState<AuthFormState, FormData>(signUpShop, {})
  const err = (k: string) => state.fieldErrors?.[k]?.[0]

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Field label="Shop or owner name" htmlFor="fullName" required error={err('fullName')}>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="organization"
          required
          aria-invalid={!!err('fullName')}
        />
      </Field>

      <Field label="Email" htmlFor="email" required error={err('email')}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={!!err('email')}
        />
      </Field>

      <Field
        label="Mobile number"
        htmlFor="phone"
        required
        hint="Myanmar mobile, e.g. 09 791 234 567"
        error={err('phone')}
      >
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="09 791 234 567"
          required
          aria-invalid={!!err('phone')}
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        required
        hint="At least 8 characters"
        error={err('password')}
      >
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          aria-invalid={!!err('password')}
        />
      </Field>

      <Field
        label="Confirm password"
        htmlFor="confirmPassword"
        required
        error={err('confirmPassword')}
      >
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          required
          aria-invalid={!!err('confirmPassword')}
        />
      </Field>

      <SubmitButton />
    </form>
  )
}
