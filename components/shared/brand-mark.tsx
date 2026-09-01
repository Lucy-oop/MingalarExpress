import { cn } from '@/lib/utils'

/**
 * Wordmark drawn in CSS rather than shipping the raster logo: the login screen
 * is the first thing on a cold cache over Yangon mobile data, and a 1.5 MB PNG
 * is a bad first impression. Swap for the real SVG when it is exported.
 */
export function BrandMark({ className, tagline = true }: { className?: string; tagline?: boolean }) {
  return (
    <div className={cn('select-none text-center', className)}>
      <div className="flex items-baseline justify-center gap-2">
        <span className="text-3xl font-black uppercase italic tracking-tight text-brand-red">
          Mingalar
        </span>
        <span className="text-lg font-semibold uppercase tracking-[0.3em] text-charcoal">
          Express
        </span>
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
