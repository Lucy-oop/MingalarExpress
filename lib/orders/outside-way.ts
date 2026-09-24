import { codCollectable } from '@/lib/pricing'
import { bookingPayment, parseAmount, type AmountProblem, type CustomerPaid } from './booking'

/**
 * Outside Way: parcels the office books by hand, for senders who send the order
 * in a chat or a phone call instead of through the portal.
 *
 * PURE, so the rules the form previews and the rules the server action applies
 * are the same functions, and a test can pin them. The action is
 * lib/admin/outside-way.ts; the page is app/admin/outside-way.
 */

/** `orders.source`, mirroring `orders_source_known` (migration 0048). */
export const ORDER_SOURCES = ['portal', 'telegram', 'viber', 'facebook', 'phone', 'other'] as const
export type OrderSource = (typeof ORDER_SOURCES)[number]

/** The channels an Outside Way parcel can arrive through: every source but the portal. */
export const OUTSIDE_CHANNELS = ['telegram', 'viber', 'facebook', 'phone', 'other'] as const
export type OutsideChannel = (typeof OUTSIDE_CHANNELS)[number]

export function isOutsideChannel(value: unknown): value is OutsideChannel {
  return typeof value === 'string' && (OUTSIDE_CHANNELS as readonly string[]).includes(value)
}

/** Both languages, since the admin shell renders whichever the cookie says. */
export const SOURCE_LABEL: Record<OrderSource, { en: string; my: string }> = {
  portal: { en: 'Portal', my: 'ဝက်ဘ်ဆိုက်' },
  telegram: { en: 'Telegram', my: 'Telegram' },
  viber: { en: 'Viber', my: 'Viber' },
  facebook: { en: 'Facebook', my: 'Facebook' },
  phone: { en: 'Phone call', my: 'ဖုန်းခေါ်ဆို' },
  other: { en: 'Other', my: 'အခြား' },
}

/**
 * The shop picker's value for "no account: file it under the house Direct shop".
 * Not a uuid, so it can never collide with a real shop id.
 */
export const DIRECT_SHOP = 'direct'

/**
 * The office's delivery fee, or null for "use the zone price".
 *
 * Blank means the zone price, NOT zero: an office that leaves the field alone
 * meant the rate card, and a free delivery has to be typed as 0 on purpose.
 */
export function parseFeeOverride(
  raw: string,
): { ok: true; value: number | null } | { ok: false; reason: AmountProblem } {
  if (raw.trim() === '') return { ok: true, value: null }
  const parsed = parseAmount(raw)
  return parsed.ok ? { ok: true, value: parsed.value } : parsed
}

export type OutsidePayment =
  | {
      ok: true
      paymentMethod: 'cod' | 'prepaid'
      goodsValue: number
      feePayer: 'customer' | 'shop'
      /** What the rider collects at the door: `orders.cod_amount`. */
      collect: number
    }
  | { ok: false; reason: `amount_${AmountProblem}` }

/**
 * What gets stored for the office's three-way "what has the customer paid".
 *
 * The same answer the shop's booking form asks, through the same
 * `bookingPayment`, for the same reason: a blank goods figure must never be
 * read as "already paid". Only 'nothing' asks for an amount, and there it is
 * required.
 */
export function outsidePayment(
  paid: CustomerPaid,
  amountRaw: string,
  feePayer: 'customer' | 'shop',
  fee: number,
): OutsidePayment {
  const amount = parseAmount(amountRaw)
  if (paid === 'nothing') {
    if (!amount.ok) return { ok: false, reason: `amount_${amount.reason}` }
    if (amount.value < 1) return { ok: false, reason: 'amount_empty' }
  }

  const p = bookingPayment(paid, amount, feePayer)
  const collect =
    p.paymentMethod === 'cod' ? codCollectable(p.goodsValue, fee, p.feePayer) : 0
  return { ok: true, ...p, collect }
}
