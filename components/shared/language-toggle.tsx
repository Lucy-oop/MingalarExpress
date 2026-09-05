'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setLocale } from '@/lib/i18n/actions'
import { LOCALES, LOCALE_LABEL, type Locale } from '@/lib/i18n'
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
            'min-h-11 rounded-md px-3 text-sm font-medium lg:min-h-9',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            l === locale
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted active:bg-muted',
            pending && 'opacity-60',
          )}
        >
          {LOCALE_LABEL[l]}
        </button>
      ))}
    </div>
  )
}
