/**
 * The rules a printed waybill has to get right.
 *
 * Everything here is pure so it can be unit-tested, because a label is the one
 * surface with no feedback loop: it is ink on a box in a rider's hand, read by
 * someone who cannot see the database. A wrong figure here is discovered by a
 * customer being asked for the wrong money at their front door.
 *
 * The rendering lives in components/orders/parcel-label.tsx.
 */

import { formatMmk } from '@/lib/utils'

/** One printed sheet is one order, so a stack of 100 is already a long roll. */
export const MAX_LABELS = 100

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export type LabelMoneyInput = {
  payment_method: 'cod' | 'prepaid'
  cod_amount: number
  delivery_fee: number
  fee_payer: string
}

export type LabelMoney =
  | { collect: false }
  | { collect: true; amount: number; text: string; feeNote: 'included' | 'shop_pays' }

/**
 * What the COLLECT box says.
 *
 * THE RULE, and the reason this is a tested function rather than an expression
 * in JSX: `cod_amount` is ALREADY the total the rider takes, delivery fee
 * included when `fee_payer = 'customer'`. The column comment in
 * 20260825090100_init.sql:313 says so, and the whole settlement chain depends
 * on it — which is exactly why it is easy to forget when writing a template and
 * "helpfully" print `cod_amount + delivery_fee`. That mistake overcharges every
 * customer-pays parcel by the fee, on paper, where no constraint can catch it.
 *
 * So: print `cod_amount`, alone, always. `fee_payer` only decides the small
 * print underneath.
 */
export function labelMoney(order: LabelMoneyInput): LabelMoney {
  if (order.payment_method !== 'cod' || order.cod_amount <= 0) return { collect: false }
  return {
    collect: true,
    amount: order.cod_amount,
    text: formatMmk(order.cod_amount),
    feeNote: order.fee_payer === 'customer' ? 'included' : 'shop_pays',
  }
}

// ---------------------------------------------------------------------------
// Query-string input
// ---------------------------------------------------------------------------

/**
 * Postgres `uuid` shape, NOT RFC 9562 — the same rule as `dbId` in
 * lib/validation/schemas.ts, and for the same reason: this project's own seed
 * uses ids like aaaaaaaa-0000-0000-0000-000000000001 that Postgres accepts and
 * a version-checking validator does not.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `?ids=a,b,c` from the URL bar.
 *
 * Untrusted, so anything that is not uuid-shaped is dropped rather than passed
 * to PostgREST, which would answer a malformed uuid with a 400 and take the
 * whole page down with it. Dropping is safe here and not a silent failure: RLS
 * already means an id belonging to another shop yields no row, so "some ids
 * produced no label" is a case the page has to handle regardless.
 */
export function parseLabelIds(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return []
  const joined = Array.isArray(raw) ? raw.join(',') : raw
  const seen = new Set<string>()
  for (const part of joined.split(',')) {
    const id = part.trim().toLowerCase()
    if (UUID_SHAPE.test(id)) seen.add(id)
    if (seen.size >= MAX_LABELS) break
  }
  return [...seen]
}

// ---------------------------------------------------------------------------
// Small print
// ---------------------------------------------------------------------------

/**
 * Grams as a human reads them. `lib/utils.ts` has no weight formatter and this
 * is the only caller, so it lives here with its tests.
 */
export function formatWeight(grams: number | null | undefined): string | null {
  if (grams === null || grams === undefined || grams <= 0) return null
  if (grams < 1000) return `${Math.round(grams)} g`
  // Rounded in integer space, not via toFixed: 2050 / 1000 is held as
  // 2.04999…, so `(2.05).toFixed(1)` is "2.0" and 50 g vanish. Tenths of a kilo
  // first, then divide, which is exact for every input the column allows.
  const tenths = Math.round(grams / 100)
  // One decimal, but never a trailing ".0" — "2 kg" reads better than "2.0 kg".
  return `${tenths / 10} kg`
}

/**
 * The destination area, in both scripts.
 *
 * Deliberately NOT locale-dependent. Every other surface picks a script from
 * the viewer's cookie, but nobody views a label — it is read by a rider who
 * reads Burmese and handed to a customer who may read either, neither of whom
 * chose the language the shop happened to have selected when they pressed
 * print. So both go on, Burmese first, and the pair collapses to one when
 * `name_mm` is missing or identical.
 */
export function labelAreaName(
  area: { name: string; name_mm?: string | null } | null | undefined,
): string | null {
  if (!area) return null
  const en = area.name?.trim()
  const mm = area.name_mm?.trim()
  if (!en && !mm) return null
  if (!mm || mm === en) return en || null
  if (!en) return mm
  return `${mm} · ${en}`
}
