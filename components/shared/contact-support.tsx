import Link from 'next/link'
import { ArrowRight, Phone } from 'lucide-react'
import { formatMyanmarPhone } from '@/lib/utils'
import { cn } from '@/lib/utils'

/**
 * How to reach the office.
 *
 * WHY IT EXISTS. Nine places in the app tell somebody to contact the office and
 * none of them says how — including the one every shop meets the moment they
 * finish signing up: "Your account has no shop yet. Ask the Mingalar Express
 * office to add your pickup point." There was no number anywhere in the
 * product, and `app_settings.support_phone` had been sitting there since
 * migration 0001, editable by the office, rendered to nobody.
 *
 * A `tel:` link with the number VISIBLE, not hidden behind a word: it dials on
 * a phone, and on a desktop it can still be read aloud or copied. That matches
 * how the business already runs — the rider phones the office, the office
 * phones the shop.
 *
 * IT USED TO RENDER NOTHING WITHOUT A NUMBER, on the grounds that a support
 * affordance leading nowhere is worse than none. That premise expired when
 * /contact was built: there is now somewhere to send people even when the
 * office has cleared the field, so the "More ways to reach us" line always
 * renders and only the `tel:` line depends on the number.
 */
export function ContactSupport({
  phone,
  label = 'Call the office',
  moreLabel = 'More ways to reach us',
  className,
}: {
  phone: string | null | undefined
  label?: string
  /** Translated by the caller — the shop shell has `t`, this component does not. */
  moreLabel?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      {phone ? (
        <a
          href={`tel:${phone}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded font-medium text-primary hover:underline',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <Phone className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="font-mono">{formatMyanmarPhone(phone)}</span>
          <span className="font-sans text-muted-foreground">· {label}</span>
        </a>
      ) : null}

      {/* Viber, Telegram and the rest. Kept BELOW the number, not instead of
          it: somebody whose shop is suspended wants to dial, not browse. */}
      <Link
        href="/contact"
        className={cn(
          'inline-flex items-center gap-1 rounded text-muted-foreground hover:text-foreground hover:underline',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {moreLabel}
        <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
      </Link>
    </div>
  )
}
