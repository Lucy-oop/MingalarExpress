import { formatMyanmarPhone } from '@/lib/utils'

/**
 * How to reach Mingalar Express, in the order Yangon actually reaches it.
 *
 * WHY A CODE FILE AND NOT `app_settings`. Four more settings would cost a
 * migration, a regenerated types file, four fields in `pricingSchema`, four in
 * `updatePricing`, four in `pricing-form.tsx` and four more keys in
 * `public_settings()` — and it would be the seventh migration waiting to be
 * pushed, so the page would render four blank rows until somebody ran
 * `db-push.sh`. On the one page whose entire job is being reachable.
 *
 * A Facebook page URL changes roughly never. The office phone does change, and
 * that one already has a home: `app_settings.support_phone`, editable in Super
 * Admin → Pricing. So the phone is passed IN rather than duplicated here, and
 * the constant below is only the fallback for a deployment where nobody has
 * filled the field in yet.
 *
 * A BLANK VALUE RENDERS NOTHING. Same rule `ContactSupport` follows: a channel
 * row that leads nowhere looks like help and answers nothing.
 */

/** Fallback for `app_settings.support_phone`. Also the KBZPay number (0021). */
const OFFICE_PHONE = '+959764148037'

/**
 * Two, and both are real. In Myanmar a Viber account IS a phone number, so
 * these double as numbers to ring — which is why the row shows the digits as
 * text underneath rather than hiding them behind the word "Viber".
 */
const VIBER_NUMBERS = ['+959764148037', '+959670763039'] as const

const TELEGRAM_USERNAME = 'YanNaingTun11'

/**
 * A share link rather than a vanity URL, and the `?mibextid=` tracking
 * parameter is dropped — it identifies whoever copied the link, not the page.
 * Swap in `facebook.com/<pagename>` when the page has one.
 */
const FACEBOOK_URL = 'https://www.facebook.com/share/1GDbfjNzSr/'

const TIKTOK_URL = 'https://www.tiktok.com/@mingalar.delivery'

/**
 * Not in `DICTIONARY`: this is a value the office changes, not UI copy, and
 * `dictionary.test.ts` is right to police the difference.
 *
 * Hours only — no days, because nobody has told me whether Sunday is different,
 * and inventing "Mon–Sat" would be a promise the office never made.
 */
export const OFFICE_HOURS = { en: '9:00 – 18:00', my: '၉:၀၀ – ၁၈:၀၀' } as const

export type ContactChannelId = 'phone' | 'viber' | 'telegram' | 'facebook' | 'tiktok'

export type ContactChannel = {
  id: ContactChannelId
  /** Unique per ROW, not per channel — there are two Viber numbers. */
  key: string
  /** Proper noun, deliberately untranslated. */
  name: string
  /** The number or handle, shown under the name so it can be read or copied. */
  detail: string | null
  href: string
  /**
   * `support` is how you get help; `social` is where you follow. Kept apart so
   * somebody chasing a lost parcel does not scroll past a shopping video.
   */
  kind: 'support' | 'social'
  /** Leaves the app for the open web, so the row gets rel/target treatment. */
  external: boolean
}

/**
 * `viber://chat?number=` wants the number percent-encoded, `+` and all.
 *
 * It only resolves if Viber is installed; in a desktop browser it does nothing
 * visible, which is exactly why `detail` carries the digits too.
 */
export function viberHref(phone: string): string {
  return `viber://chat?number=${encodeURIComponent(phone)}`
}

/**
 * @param supportPhone `app_settings.support_phone`, via `getPublicSettings()`.
 *   The office's own value wins; `OFFICE_PHONE` covers a deployment where the
 *   field is empty or `public_settings()` has not been pushed yet.
 */
export function contactChannels(supportPhone?: string | null): ContactChannel[] {
  const out: ContactChannel[] = []

  const phone = supportPhone?.trim() || OFFICE_PHONE
  if (phone) {
    out.push({
      id: 'phone',
      key: 'phone',
      name: 'Phone',
      detail: formatMyanmarPhone(phone),
      href: `tel:${phone}`,
      kind: 'support',
      external: false,
    })
  }

  for (const number of VIBER_NUMBERS) {
    if (!number.trim()) continue
    out.push({
      id: 'viber',
      key: `viber:${number}`,
      name: 'Viber',
      detail: formatMyanmarPhone(number),
      href: viberHref(number),
      kind: 'support',
      external: false,
    })
  }

  if (TELEGRAM_USERNAME.trim()) {
    out.push({
      id: 'telegram',
      key: 'telegram',
      name: 'Telegram',
      detail: `@${TELEGRAM_USERNAME}`,
      href: `https://t.me/${TELEGRAM_USERNAME}`,
      kind: 'support',
      external: true,
    })
  }

  if (FACEBOOK_URL.trim()) {
    out.push({
      id: 'facebook',
      key: 'facebook',
      name: 'Facebook',
      detail: null,
      href: FACEBOOK_URL,
      kind: 'social',
      external: true,
    })
  }

  if (TIKTOK_URL.trim()) {
    out.push({
      id: 'tiktok',
      key: 'tiktok',
      name: 'TikTok',
      detail: '@mingalar.delivery',
      href: TIKTOK_URL,
      kind: 'social',
      external: true,
    })
  }

  return out
}
