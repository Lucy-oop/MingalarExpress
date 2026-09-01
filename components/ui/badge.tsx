import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'border-transparent bg-muted text-muted-foreground',
        gold: 'border-transparent bg-brand-gold/20 text-[#8a6a10]',
        blue: 'border-transparent bg-blue-100 text-blue-800',
        green: 'border-transparent bg-emerald-100 text-emerald-800',
        amber: 'border-transparent bg-amber-100 text-amber-900',
        red: 'border-transparent bg-red-100 text-red-800',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

export { badgeVariants }
