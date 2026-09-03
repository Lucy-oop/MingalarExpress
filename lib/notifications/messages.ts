import type { Lang, NotificationEvent, NotificationPayload } from './types'

/**
 * The two messages, in two languages.
 *
 * Pure on purpose. These strings are the only part of the notification system a
 * non-engineer will ever want changed, and the part that costs money per
 * character — so they live in a file with no imports, no env and no client, and
 * `messages.test.ts` holds them to a two-segment ceiling.
 *
 * WHY SO TERSE. A Burmese SMS is UCS-2: 70 characters in one segment, 67 in each
 * of a concatenated pair. The first draft of these templates ran to THREE
 * segments — triple cost on every failed parcel — and measuring is what found it.
 * Three things were cut, each for its own reason:
 *
 *   the customer's name   a Burmese name forces the whole message to UCS-2 even
 *                         when the rest is English, so it cost a segment on the
 *                         English template too. The code identifies the parcel
 *                         everywhere else in this system; it can here.
 *   the rider's reason    free text, unbounded. A rider typing a paragraph must
 *                         not turn one SMS into five. It is on the parcel page.
 *   the COD amount        an SMS naming a sum of money is a phishing template.
 *
 * Both survive in `payload` for a future Viber message, where length is free.
 *
 * The Burmese `parcel_held` message also drops the attempt count, and only that
 * one: it was the single template still landing in a third segment, and "we have
 * stopped trying" is the actionable half. The exact count is on the page.
 *
 * The link is passed in rather than built here, so this module needs no
 * `process.env` and can be tested without one.
 */

const BRAND = 'Mingalar Express'

function coerceLang(lang: string | null | undefined): Lang {
  return lang === 'en' ? 'en' : 'my'
}

function coerceEvent(event: string | null | undefined): NotificationEvent {
  return event === 'parcel_held' ? 'parcel_held' : 'parcel_failed'
}

export function renderNotification(input: {
  event: string | null | undefined
  lang: string | null | undefined
  payload: NotificationPayload | null | undefined
  /** Absolute short URL to the parcel. Omitted in tests that only check wording. */
  link?: string | null
}): string {
  const event = coerceEvent(input.event)
  const lang = coerceLang(input.lang)
  const p = input.payload ?? {}

  const code = (p.code ?? '').trim() || 'your parcel'
  const attempt = Number(p.attempt ?? 1)
  const max = Number(p.max_attempts ?? 3)
  const link = (input.link ?? '').trim()
  const tail = link ? ` ${link}` : ''

  if (lang === 'en') {
    return event === 'parcel_held'
      ? `${BRAND}: ${code} failed ${max} times and is on hold. Choose what to do:${tail}`
      : `${BRAND}: ${code} failed, attempt ${attempt} of ${max}. Choose what to do:${tail}`
  }

  return event === 'parcel_held'
    ? `${BRAND}: ${code} ပို့မရ၍ ရပ်ထားပါပြီ။ ဘာလုပ်ရမလဲ ရွေးပါ -${tail}`
    : `${BRAND}: ${code} ပို့မရပါ (${attempt}/${max})။ ဘာလုပ်ရမလဲ ရွေးပါ -${tail}`
}

/**
 * Where an SMS sends a shop.
 *
 * `/o/<code>` rather than `/shop/orders/<uuid>`: a UUID is 36 characters of a
 * 70-character segment, and the code is already in the message. The redirect
 * lives at `app/o/[code]/page.tsx`.
 */
/**
 * The longest `NEXT_PUBLIC_SITE_URL` the two-segment budget survives.
 *
 * MEASURED, not guessed: the Burmese `parcel_held` body is 76 characters before
 * the link, a concatenated UCS-2 pair holds 134, and the link is the base plus
 * `/o/` plus a 17-character order code. So the base has 37 to spend and this
 * leaves a character of margin.
 *
 * It matters. Pointed at `https://mingalar-express-staging.vercel.app` (43) every
 * Burmese message costs three segments instead of two — a 50% bill increase that
 * nothing would otherwise report. The worker logs a warning when a rendered
 * message overruns; `messages.test.ts` pins the budget itself.
 */
export const MAX_LINK_BASE_LENGTH = 36

export function orderLink(baseUrl: string | null | undefined, code: string | null): string {
  const base = (baseUrl ?? '').replace(/\/+$/, '')
  if (!base) return ''
  return code ? `${base}/o/${encodeURIComponent(code)}` : `${base}/shop/orders`
}
