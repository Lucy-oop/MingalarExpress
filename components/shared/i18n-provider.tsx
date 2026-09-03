'use client'

import * as React from 'react'
import { DEFAULT_LOCALE, translator, type Locale, type Translate } from '@/lib/i18n'

/**
 * Locale for the client tree.
 *
 * WHY THIS EXISTS. The first cut passed `t` — a function — from server pages
 * into client components as a prop, and React refuses:
 *
 *     Functions cannot be passed directly to Client Components
 *
 * Only serialisable values cross the RSC boundary. A LOCALE IS A STRING; the
 * translator is built from it on the client side. `lib/i18n` imports nothing
 * server-only (no next/headers, no server-only) precisely so it can be used on
 * both sides of the line.
 *
 * Passing the whole dictionary down instead would also work and is worse: it is
 * every string in the app serialised into the HTML of every page, when the
 * client already has the module in its bundle.
 *
 * And it is a CONTEXT rather than a prop so the mistake cannot recur — no client
 * component accepts a `t` prop any more, so there is nothing for a server
 * component to hand it.
 */

const LocaleContext = React.createContext<Locale | null>(null)

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale
  children: React.ReactNode
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

let warned = false

export function useLocale(): Locale {
  const locale = React.useContext(LocaleContext)
  if (locale) return locale

  // Fall back rather than throw. A client component rendered outside the
  // provider is a developer error, and it should be loud in the console — but a
  // rider at a doorstep is better served by a label in the wrong language than
  // by a blank screen.
  if (!warned && process.env.NODE_ENV !== 'production') {
    warned = true
    console.error('[i18n] useLocale() outside <I18nProvider> — falling back to the default locale.')
  }
  return DEFAULT_LOCALE
}

/** The bound translator. Memoised on the locale, so it is stable per render. */
export function useT(): Translate {
  const locale = useLocale()
  return React.useMemo(() => translator(locale), [locale])
}
