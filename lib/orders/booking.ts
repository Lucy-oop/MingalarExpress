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
  /**
   * The delivery pin is not known to be OUTSIDE the geofence.
   *
   * TRUE WHEN THERE IS NO PIN, and `hasPin` is gone entirely — 0037 removed the
   * requirement. A shop types a customer's address out of a Viber message, and
   * most Yangon addresses do not geocode, so demanding a pin demanded a GUESS
   * about a street the shop has never visited. `dropoffAreaId` is the locator
   * now, and it is the better one: a pin said "somewhere in Greater Yangon",
   * an area says "South Okkalapa, which Route C visits, priced 4,000".
   *
   * A pin that IS dropped still has to be inside, because that one is a mistake
   * the shop just made and can immediately correct.
   */
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
  /**
   * The shop has to type a goods figure, which is true for ONE of the three
   * things a customer may have paid.
   *
   * WAS `prepaid: boolean`, and a boolean could only say two things where there
   * are three. "Nothing paid" needs an amount; "the product only" does not,
   * because the rider collects the delivery fee and nothing else; "everything
   * paid" does not either. The old flag lumped the middle case in with the
   * first and demanded a figure it has no field for -- `amount_empty` fires on
   * anything under 1, so that case could not be booked at all.
   */
  needsAmount: boolean
  amount: AmountParse
}

export type BookingBlocker =
  | 'pickup_outside'
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
  if (!g.pinInServiceArea) return 'pin_outside'
  if (g.addressLength < MIN_ADDRESS_LENGTH) return 'no_address'
  if (!g.hasArea) return 'no_area'

  /*
    THE CLAUSE THAT WAS MISSING, and it still is the one that matters: "they
    left it blank" must never be read as "already paid". It now applies only
    where an amount is actually asked for -- see `needsAmount`.
  */
  if (g.needsAmount && !g.amount.ok) return `amount_${g.amount.reason}`
  if (g.needsAmount && g.amount.ok && g.amount.value < 1) return 'amount_empty'

  return null
}

export function bookingReady(g: BookingGate): boolean {
  return bookingBlocker(g) === null
}

/**
 * WHAT THE CUSTOMER HAS ALREADY PAID — the three real answers.
 *
 * This was a boolean, and a boolean could not say the middle one. A customer
 * often pays the shop for the PRODUCT and leaves the delivery fee to be
 * collected at the door; the form offered only "collect the full amount" or
 * "collect nothing", so that parcel could not be booked.
 *
 *   'nothing'   the rider collects the goods, and the fee too if the customer
 *               is paying it
 *   'product'   the rider collects the DELIVERY FEE and nothing else
 *   'all'       the rider collects nothing
 */
export type CustomerPaid = 'nothing' | 'product' | 'all'

/**
 * What actually gets posted, derived from the same inputs the preview uses.
 *
 * The old form derived `paymentMethod` from whether the amount happened to be
 * zero, so a blank field and a genuinely prepaid parcel were indistinguishable.
 * It is now the stated answer, and only that.
 *
 * NO MIGRATION HOLDS THIS UP: all three shapes were already legal.
 * `codCollectable(0, fee, 'customer')` is `fee`, and `orders_cod_consistent`
 * wants `cod_amount > 0` for a COD parcel — which a positive fee satisfies. The
 * settlement query lands right on its own too: with `fee_payer = 'customer'`,
 * `goods_value` and `owed_to_shop` are both `cod_amount - delivery_fee` = 0,
 * `platform_fees` is the fee, and the parts still sum to the collection.
 *
 * `feePayer` IS ONLY A CHOICE IN ONE CASE:
 *
 *   'product'  ->  'customer', by definition — they are paying it at the door
 *   'all'      ->  'shop', because `cod_by_shop` ignores fee_payer off COD and
 *                  bills the shop regardless; storing 'customer' would be a row
 *                  contradicting the query that reads it
 *   'nothing'  ->  the shop's, because it may still absorb the fee itself
 */
export function bookingPayment(
  paid: CustomerPaid,
  amount: AmountParse,
  feePayer: 'customer' | 'shop',
): { paymentMethod: 'cod' | 'prepaid'; goodsValue: number; feePayer: 'customer' | 'shop' } {
  if (paid === 'all') return { paymentMethod: 'prepaid', goodsValue: 0, feePayer: 'shop' }
  if (paid === 'product') return { paymentMethod: 'cod', goodsValue: 0, feePayer: 'customer' }
  return {
    paymentMethod: 'cod',
    goodsValue: amount.ok ? amount.value : 0,
    feePayer,
  }
}
