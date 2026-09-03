'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { isLocale, type Locale } from './index'
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from './locale'

/**
 * Switch language.
 *
 * The cookie is what every render reads, so no page pays for a profile lookup.
 * `profiles.preferred_lang` is written alongside as the durable record, so a
 * rider signing in on a replacement phone gets their language back — and it is
 * best effort, because a rider on a stalled connection must still get the
 * switch on the device in their hand.
 */
export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return

  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
  })

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('profiles').update({ preferred_lang: locale }).eq('id', user.id)
    }
  } catch {
    // The cookie is already set; the profile catches up on the next switch.
  }
}
