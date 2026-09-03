import { DICTIONARY, type MessageKey } from './dictionary'

export type { MessageKey }
export { DICTIONARY }

export const LOCALES = ['my', 'en'] as const
export type Locale = (typeof LOCALES)[number]

/** Burmese is the default, not the fallback. See the note in dictionary.ts. */
export const DEFAULT_LOCALE: Locale = 'my'

export const LOCALE_LABEL: Record<Locale, string> = { my: 'မြန်မာ', en: 'English' }

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * Look up a string, substituting `{name}` placeholders.
 *
 * Pure and total: an unknown key returns the key itself rather than throwing or
 * rendering an empty box. A rider seeing `jobs.next` on screen is a bug report;
 * a rider seeing nothing is a mystery.
 */
export function t(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const entry = DICTIONARY[key]
  if (!entry) return key

  let text: string = entry[locale] ?? entry[DEFAULT_LOCALE]
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/** Bound to one locale, so components take a single `t` rather than both. */
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

export function translator(locale: Locale): Translate {
  return (key, params) => t(locale, key, params)
}

/**
 * Burmese digits, for counts a rider reads at a glance.
 *
 * Deliberately NOT used for money or for order codes: `formatMmk` and the code
 * are cross-checked against paperwork and a screen the office can read, and a
 * dispute is not the moment to be transliterating numerals.
 */
const MY_DIGITS = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉']

export function localeNumber(locale: Locale, n: number): string {
  const s = String(n)
  return locale === 'my' ? s.replace(/\d/g, (d) => MY_DIGITS[Number(d)]!) : s
}
