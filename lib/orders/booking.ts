import { MAX_MMK } from '@/lib/validation/limits'

/**
 * Whether a parcel can be booked, and if not, exactly why.
 *
 * WHY THIS IS A MODULE AND NOT A BOOLEAN IN THE FORM. The gate used to be one
 * inline expression, and it silently omitted the amount:
 *
 *     const canSubmit = !!dropoff && !!area && isInServiceArea(dropoff) && ...
 *
 * so an empty amount booked a COD parcel as PREPAID — the rider collected
 * nothing, the customer kept the goods, and the shop was billed the delivery
 * fee. Nothing downstream noticed, because a prepaid parcel is a legitimate
 * thing. Neither tsc nor the build can see a missing clause in a boolean; a
 * missing clause here is a failing test.
 */

export type AmountProblem = 'empty' | 'not_a_number' | 'decimal' | 'negative' | 'too_large'

export type AmountParse = { ok: true; value: number } | { ok: false; reason: AmountProblem }

/**
 * What the shop typed into "amount to collect", as a number the server will
 * accept — or the reason it will not.
 *
 * DELIBERATELY NOT A SANITISER. Stripping non-digits as the shop types looks
 * tidier and is dangerous: "45000." then "5" would silently become 450005, ten
 * times the amount, with nothing on screen to say so. Rejecting the value and
 * naming the problem keeps the number the shop typed in front of them.
 *
 * Thousands separators ARE accepted, because "45,000" and "45 000" are how
 * people write kyat and there is nothing ambiguous about either.
 */
export function parseAmount(raw: string): AmountParse {
  const cleaned = raw.replace(/[,\s]/g, '')
  if (cleaned.length === 0) return { ok: false, reason: 'empty' }

  if (!/^\d+$/.test(cleaned)) {
    if (cleaned.startsWith('-')) return { ok: false, reason: 'negative' }
    // A decimal point is the common slip; `1e9` and stray letters are not.
    if (/^\d*[.٫]\d*$/.test(cleaned)) return { ok: false, reason: 'decimal' }
    return { ok: false, reason: 'not_a_number' }
  }

  const value = Number(cleaned)
  // Number() on a very long digit string loses precision before it exceeds the
  // ceiling, so the length check has to come first.
  if (!Number.isSafeInteger(value)) return { ok: false, reason: 'too_large' }
  if (value > MAX_MMK) return { ok: false, reason: 'too_large' }

  return { ok: true, value }
}

export type BookingGate = {
  /** A pin has been dropped. */
  hasPin: boolean
  /** ...and it is inside the delivery geofence. */
  pinInServiceArea: boolean
  /**
   * The shop's own saved location is not known to be OUTSIDE the geofence.
   *
   * TRUE WHEN THERE IS NO PIN AT ALL, which reads oddly until you ask what the
   * gate is for. Since 0036 a shop can book with no coordinates, and "we do not
   * know where this shop is" must not be answered with 'pickup_outside' — that
   * told the merchant their own shop was outside our delivery area and refused
   * a submit they could not fix from the booking screen.
   *
   * They cannot fix a genuinely out-of-area pin here either; that one is a real
   * block, and `shops_pickup_in_service_area` would refuse the row regardless.
   */
  pickupInServiceArea: boolean
  /** Trimmed length of the delivery address. */
  addressLength: number
  hasArea: boolean
  /** The shop ticked "already paid — collect nothing". */
  prepaid: boolean
  amount: AmountParse
}

export type BookingBlocker =
  | 'pickup_outside'
  | 'no_pin'
  | 'pin_outside'
  | 'no_address'
  | 'no_area'
  | `amount_${AmountProblem}`

/** The delivery address the server will accept — mirrors `orderCreateSchema`. */
export const MIN_ADDRESS_LENGTH = 5

/**
 * The FIRST thing standing between this parcel and being booked, in the order a
 * shop would fix them: their own setup, then the map, then the money.
 *
 * Returns null when the parcel is ready. One reason at a time rather than a
 * list, because the message sits under a single button.
 */
export function bookingBlocker(g: BookingGate): BookingBlocker | null {
  if (!g.pickupInServiceArea) return 'pickup_outside'
  if (!g.hasPin) return 'no_pin'
  if (!g.pinInServiceArea) return 'pin_outside'
  if (g.addressLength < MIN_ADDRESS_LENGTH) return 'no_address'
  if (!g.hasArea) return 'no_area'

  // THE CLAUSE THAT WAS MISSING. A prepaid parcel needs no amount; anything
  // else does, and "they left it blank" must never be read as "already paid".
  if (!g.prepaid && !g.amount.ok) return `amount_${g.amount.reason}`
  if (!g.prepaid && g.amount.ok && g.amount.value < 1) return 'amount_empty'

  return null
}

export function bookingReady(g: BookingGate): boolean {
  return bookingBlocker(g) === null
}

/**
 * What actually gets posted, derived from the same inputs the preview uses.
 *
 * The old form derived `paymentMethod` from whether the amount happened to be
 * zero, so a blank field and a genuinely prepaid parcel were indistinguishable.
 * It is now the tick, and only the tick.
 *
 * `feePayer` is forced to 'shop' on a prepaid parcel because that is what
 * actually happens: `cod_by_shop` ignores fee_payer when payment_method is not
 * 'cod' and bills the shop regardless. Storing 'customer' there would be a row
 * that contradicts the query reading it.
 */
export function bookingPayment(
  prepaid: boolean,
  amount: AmountParse,
  feePayer: 'customer' | 'shop',
): { paymentMethod: 'cod' | 'prepaid'; goodsValue: number; feePayer: 'customer' | 'shop' } {
  if (prepaid) return { paymentMethod: 'prepaid', goodsValue: 0, feePayer: 'shop' }
  return {
    paymentMethod: 'cod',
    goodsValue: amount.ok ? amount.value : 0,
    feePayer,
  }
}
