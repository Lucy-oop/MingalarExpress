import * as React from 'react'
import { cn } from '@/lib/utils'

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/30',
        className,
      )}
      {...props}
    />
  )
}
