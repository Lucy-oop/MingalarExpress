import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-[var(--brand-red-dark)]',
        gold: 'bg-brand-gold text-charcoal hover:brightness-95',
        outline: 'border bg-background hover:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:brightness-95',
        ghost: 'hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:brightness-95',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-12 rounded-md px-6 text-base',
        // Riders tap this with a thumb, in a helmet, one-handed. 56px minimum.
        touch: 'h-14 rounded-lg px-6 text-base font-semibold',
        icon: 'size-10',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'default', size: 'default', block: false },
  },
)

export type ButtonProps = React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, block, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, block }), className)} {...props} />
}

export { buttonVariants }
