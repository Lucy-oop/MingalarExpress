/**
 * SMS segment arithmetic.
 *
 * This exists because the platform is paying. A Burmese message is UCS-2, which
 * fits **70 characters per segment**, not 160 — so a template that reads fine in
 * English can silently cost three times as much in Burmese. `messages.test.ts`
 * asserts a ceiling on every template, which is only meaningful if the counting
 * is right.
 *
 * Reference: 3GPP TS 23.038. Concatenated messages spend 7 characters of each
 * segment on the UDH, hence 153 (GSM-7) and 67 (UCS-2) rather than 160 and 70.
 */

/** GSM 03.38 basic set. Anything outside it forces the whole message to UCS-2. */
const GSM7_BASIC = new Set(
  ('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà').split(''),
)

/** Sent as ESC + char, so each one costs two of the 160. */
const GSM7_EXTENDED = new Set(['\f', '^', '{', '}', '\\', '[', '~', ']', '|', '€'])

export type SmsEncoding = 'gsm7' | 'ucs2'

export function smsEncoding(body: string): SmsEncoding {
  for (const ch of body) {
    if (!GSM7_BASIC.has(ch) && !GSM7_EXTENDED.has(ch)) return 'ucs2'
  }
  return 'gsm7'
}

/** Billable length: GSM-7 septets, or UTF-16 code units for UCS-2. */
export function smsLength(body: string): number {
  if (smsEncoding(body) === 'ucs2') return body.length
  let n = 0
  for (const ch of body) n += GSM7_EXTENDED.has(ch) ? 2 : 1
  return n
}

export function smsSegments(body: string): number {
  if (body.length === 0) return 0
  const ucs2 = smsEncoding(body) === 'ucs2'
  const len = smsLength(body)
  const single = ucs2 ? 70 : 160
  const multi = ucs2 ? 67 : 153
  return len <= single ? 1 : Math.ceil(len / multi)
}
