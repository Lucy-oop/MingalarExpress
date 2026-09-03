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
          disabled={pending || l === locale}
          aria-pressed={l === locale}
          onClick={() =>
            startTransition(async () => {
              await setLocale(l)
              router.refresh()
            })
          }
          className={cn(
            'min-h-11 rounded-md px-3 text-sm font-medium',
            l === locale
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground active:bg-muted',
            pending && 'opacity-60',
          )}
        >
          {LOCALE_LABEL[l]}
        </button>
      ))}
    </div>
  )
}
