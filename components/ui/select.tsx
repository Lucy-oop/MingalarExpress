import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Native <select>. Deliberate: on the rider PWA and on the cheap Android phones
 * Yangon shops actually use, the OS picker is faster and more reliable than any
 * JS listbox, and it works with no JS at all in a progressively-enhanced form.
 */
export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  )
}
