import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, isLocale, type Locale } from './index'

/**
 * Which language this request renders in.
 *
 * A COOKIE, read on the server. Not a URL segment (`/my/rider/...`) because that
 * would rewrite every link in the app for a two-language toggle, and not client
 * state because the rider app is server-rendered — a flash of English before
 * hydration is exactly the confusion this exists to remove.
 *
 * NOT a `'use server'` module: that restricts a file to exporting async
 * functions only, and the cookie name is a constant two other places need. The
 * mutation lives next door in `actions.ts`.
 */

export const LOCALE_COOKIE = 'mge_locale'
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export async function getLocale(): Promise<Locale> {
  const store = await cookies()
  const value = store.get(LOCALE_COOKIE)?.value
  return isLocale(value) ? value : DEFAULT_LOCALE
}
