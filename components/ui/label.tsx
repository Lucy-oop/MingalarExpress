import * as React from 'react'
import { cn } from '@/lib/utils'

export function Label({
  className,
  required,
  ...props
}: React.ComponentProps<'label'> & { required?: boolean }) {
  return (
    <label className={cn('text-sm font-medium leading-none', className)} {...props}>
      {props.children}
      {required ? <span className="ml-0.5 text-destructive">*</span> : null}
    </label>
  )
}
