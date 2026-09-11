'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setLocale } from '@/lib/i18n/actions'
import { LOCALES, LOCALE_LABEL, LOCALE_LABEL_SHORT, type Locale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * မြန်မာ | English
 *
 * Two labelled segments rather than a dropdown or a flag icon. A rider who
 * cannot read the current language cannot read a dropdown's closed state either
 * — both options have to be visible and tappable, each in its OWN script, so the
 * one you can read is the one you press.
 *
 * Sized for a thumb (44px), not for a desktop toolbar.
 *
 * SHORTENED BELOW `sm`, NOT COLLAPSED. "မြန်မာ | English" is ~152px, which on a
 * 360px phone is nearly half the header and was most of why the shop bar wrapped
 * onto a second row. The obvious saving — one button showing the language you
 * would switch TO — breaks the rule above, so both segments stay and only the
 * labels shorten: မြန် and EN, each still in its own script, so the one you can
 * read is still the one you press. The full words come back at `sm`.
 */
export function LanguageToggle({ locale }: { locale: Locale }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <div
      className="flex shrink-0 rounded-lg border bg-background p-0.5"
      role="group"
      aria-label={LOCALE_LABEL[locale]}
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          /*
            NOT `disabled` when this is the current language. Disabling it took
            it out of the tab order, so the aria-pressed="true" it carries was
            never announced: a keyboard or screen-reader user tabbed into the
            group, reached only the OTHER language, and was never told which one
            was on. It stays focusable and the click is a no-op instead.
          */
          disabled={pending}
          aria-pressed={l === locale}
          onClick={() => {
            if (l === locale) return
            startTransition(async () => {
              await setLocale(l)
              router.refresh()
            })
          }}
          className={cn(
            // Thumb-sized on a phone, which is every rider always; eight pixels
            // shorter in a desktop toolbar, where it was the tallest thing in
            // the bar and set the whole header's height.
            'min-h-11 rounded-md px-2.5 text-sm font-medium sm:px-3 lg:min-h-9',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            l === locale
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted active:bg-muted',
            pending && 'opacity-60',
          )}
        >
          <span className="sm:hidden">{LOCALE_LABEL_SHORT[l]}</span>
          <span className="hidden sm:inline">{LOCALE_LABEL[l]}</span>
        </button>
      ))}
    </div>
  )
}
