'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { LogIn } from 'lucide-react'
import { signIn, type AuthFormState } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" block disabled={pending}>
      <LogIn />
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  )
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<AuthFormState, FormData>(signIn, {})

  return (
    <form action={action} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Field
        label="Email"
        htmlFor="email"
        required
        error={state.fieldErrors?.email?.[0]}
      >
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={!!state.fieldErrors?.email}
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        required
        error={state.fieldErrors?.password?.[0]}
      >
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          aria-invalid={!!state.fieldErrors?.password}
        />
      </Field>

      <SubmitButton />
    </form>
  )
}
