import { cn } from '@/lib/utils'

/**
 * Wordmark drawn in CSS rather than shipping the raster logo: the login screen
 * is the first thing on a cold cache over Yangon mobile data, and a 1.5 MB PNG
 * is a bad first impression. Swap for the real SVG when it is exported.
 *
 * Two sizes because the same mark serves two jobs. `md` is the hero lockup on
 * the login and tracking screens, where it is the only thing on the page. `sm`
 * is for an app toolbar, where 30px type is not branding, it is the reason the
 * header needs a second row.
 */
const SIZES = {
  md: { name: 'text-3xl', word: 'text-lg tracking-[0.3em]', gap: 'gap-2' },
  sm: { name: 'text-xl', word: 'text-[10px] tracking-[0.25em]', gap: 'gap-1.5' },
} as const

export function BrandMark({
  className,
  tagline = true,
  size = 'md',
}: {
  className?: string
  tagline?: boolean
  size?: keyof typeof SIZES
}) {
  const s = SIZES[size]
  return (
    <div className={cn('select-none text-center', className)}>
      <div className={cn('flex items-baseline justify-center', s.gap)}>
        <span
          className={cn('font-black uppercase italic tracking-tight text-brand-red', s.name)}
        >
          Mingalar
        </span>
        <span className={cn('font-semibold uppercase text-charcoal', s.word)}>Express</span>
      </div>
      {tagline ? (
        <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Fast <span className="text-brand-gold">•</span> Friendly{' '}
          <span className="text-brand-gold">•</span> Trusted
        </p>
      ) : null}
    </div>
  )
}
