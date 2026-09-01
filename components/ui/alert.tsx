import * as React from 'react'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS = { error: AlertCircle, success: CheckCircle2, info: Info } as const

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof ICONS
  title?: string
  children?: React.ReactNode
  className?: string
}) {
  const Icon = ICONS[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex gap-3 rounded-md border p-3 text-sm',
        tone === 'error' && 'border-destructive/30 bg-destructive/5 text-destructive',
        tone === 'success' && 'border-emerald-300 bg-emerald-50 text-emerald-800',
        tone === 'info' && 'border-border bg-muted text-muted-foreground',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-0.5')}>{children}</div> : null}
      </div>
    </div>
  )
}
