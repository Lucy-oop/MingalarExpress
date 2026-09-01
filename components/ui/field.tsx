import * as React from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** Label + control + hint + error, wired for accessibility in one place. */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: string
  htmlFor: string
  required?: boolean
  hint?: string
  error?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
