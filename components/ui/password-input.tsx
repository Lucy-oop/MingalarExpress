'use client'

import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Password field with a reveal toggle.
 *
 * Wraps the shared `Input` rather than restyling one, so border radius, height,
 * font, focus ring and the `aria-invalid` treatment stay identical to every
 * other field on the form.
 *
 * The button is 40px square and pinned to the field's own box (`inset-y-0`), so
 * it cannot change the field's height and the hint or error line underneath
 * never moves. `ring-inset` keeps the focus ring inside that box instead of
 * drawing it over the input's border.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = React.useState(false)
  const Icon = visible ? EyeOff : Eye

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        className={cn(
          'pr-10',
          // Edge and IE render their own reveal/clear affordances inside a
          // password input, which would sit right under ours as a second eye.
          '[&::-ms-reveal]:hidden [&::-ms-clear]:hidden',
          className,
        )}
      />
      <button
        type="button"
        // Inside a <form>, a button with no explicit type submits it -- which
        // here would post a half-filled signup on the first tap.
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        // The label already names the action; the glyph is decoration.
        className={cn(
          'absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md',
          'text-muted-foreground transition-colors hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
          'focus-visible:ring-ring',
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
