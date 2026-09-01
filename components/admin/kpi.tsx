import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * Presentational tiles shared by the Super Admin pages. Server components on
 * purpose — none of them own state, and keeping them off the client bundle
 * keeps the dashboard a single static payload.
 */

export type KpiTone = 'default' | 'good' | 'warn' | 'bad'

const TONES: Record<KpiTone, string> = {
  default: 'border-border bg-card',
  good: 'border-emerald-200 bg-emerald-50',
  warn: 'border-amber-300 bg-amber-50',
  bad: 'border-destructive/30 bg-destructive/5',
}

export function Kpi({
  label,
  value,
  hint,
  tone = 'default',
  href,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: KpiTone
  href?: string
}) {
  const body = (
    <>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </>
  )

  const className = cn(
    'block rounded-lg border p-4 transition-colors',
    TONES[tone],
    href && 'hover:border-primary/40 hover:shadow-sm',
  )

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

/** A labelled figure inside a card — the settlement and ledger detail views. */
export function Stat({
  label,
  value,
  emphasis,
  hint,
}: {
  label: string
  value: string
  emphasis?: boolean
  hint?: string
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn('tabular-nums', emphasis ? 'text-lg font-semibold' : 'text-sm font-medium')}>
        {value}
      </p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Page heading + optional description and right-aligned actions. */
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold">{title}</h1>
        {description ? (
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  )
}
