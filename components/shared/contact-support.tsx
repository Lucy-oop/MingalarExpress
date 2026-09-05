import { Phone } from 'lucide-react'
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
 * RENDERS NOTHING WITHOUT A NUMBER. A support affordance that leads nowhere is
 * worse than none: it looks like help and answers nothing. If the office clears
 * the field, the prompts go back to saying "contact the office" with no link,
 * which is at least honest.
 */
export function ContactSupport({
  phone,
  label = 'Call the office',
  className,
}: {
  phone: string | null | undefined
  label?: string
  className?: string
}) {
  if (!phone) return null

  return (
    <a
      href={`tel:${phone}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded font-medium text-primary hover:underline',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <Phone className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="font-mono">{formatMyanmarPhone(phone)}</span>
      <span className="font-sans text-muted-foreground">· {label}</span>
    </a>
  )
}
