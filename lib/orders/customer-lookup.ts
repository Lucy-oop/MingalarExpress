/**
 * Finding a customer the shop has sent to before.
 *
 * A shop sending ten parcels retypes the same regulars every time — name, phone,
 * address, area, and a map pin they place by hand. Every one of those is already
 * on a row they own.
 *
 * IT IS ALSO THE MOST PRECISE SOURCE OF COORDINATES WE HAVE. `dropoff_lat/lng`
 * are NOT NULL with a geofence CHECK, so a booking always needs a point from
 * somewhere; reusing a past order's point means a real place the rider has
 * already been to, rather than a geocode guess or a township centroid flagged
 * VERIFY-CENTROID.
 *
 * SCOPING IS RLS, NOT THIS FILE. `orders_read_shop` is `owns_shop(shop_id)`, so
 * the query underneath cannot see another shop's customers whatever it asks
 * for. Nothing here filters by shop and nothing here should — a filter in the
 * query would imply the filter is what protects the data.
 *
 * Pure, so the deduping and the phone matching are testable without a database.
 */

export const MIN_LOOKUP_LENGTH = 2
export const LOOKUP_LIMIT = 6

/** The columns worth reusing. Deliberately not the money or the parcel. */
export type PastOrderRow = {
  customer_name: string
  customer_phone: string
  customer_phone_alt: string | null
  dropoff_address: string
  dropoff_area_id: string | null
  dropoff_lat: number | null
  dropoff_lng: number | null
  dropoff_note: string | null
  created_at: string
}

export type RecentCustomer = PastOrderRow & { orderCount: number }

/**
 * Myanmar mobile numbers, reduced to the part that identifies them.
 *
 * Stored as `+959791234567`. A shop types `09791234567`, or `9791234567`, or
 * just the last six digits they remember. Stripping the country code and the
 * trunk zero from both sides makes all of those match the same customer.
 */
export function phoneDigits(value: string): string {
  let d = (value ?? '').replace(/\D/g, '')
  if (d.startsWith('95')) d = d.slice(2)
  if (d.startsWith('0')) d = d.slice(1)
  return d
}

/**
 * One entry per customer, newest first, with a count of how often they have
 * ordered.
 *
 * KEYED ON THE PHONE, not the name. Two customers can share a name and a shop
 * will have typed the same person's name three different ways; the phone is
 * what actually identifies them, and it is what the rider dials.
 *
 * The FIRST row for a phone wins, so callers must pass rows newest-first — the
 * most recent address is the one worth reusing, because people move.
 */
export function dedupeCustomers(rows: PastOrderRow[], limit = LOOKUP_LIMIT): RecentCustomer[] {
  const byPhone = new Map<string, RecentCustomer>()

  for (const row of rows) {
    const key = phoneDigits(row.customer_phone)
    if (!key) continue
    const existing = byPhone.get(key)
    if (existing) {
      existing.orderCount += 1
      continue
    }
    byPhone.set(key, { ...row, orderCount: 1 })
  }

  return [...byPhone.values()].slice(0, Math.max(1, limit))
}

/**
 * Does this customer match what the shop typed?
 *
 * Applied client-side over the rows already fetched, so a shop can narrow a
 * short list without another round trip. A digits-only term is treated as a
 * phone; anything else as a name.
 */
export function matchesTerm(customer: PastOrderRow, term: string): boolean {
  const q = term.trim().toLowerCase()
  if (q.length === 0) return true

  const digits = phoneDigits(q)
  // "09" normalises to nothing, so fall through to a name match rather than
  // matching every customer on an empty string.
  if (digits.length >= 2 && /^[\d\s+()-]+$/.test(q)) {
    return (
      phoneDigits(customer.customer_phone).includes(digits) ||
      phoneDigits(customer.customer_phone_alt ?? '').includes(digits)
    )
  }

  return customer.customer_name.toLowerCase().includes(q)
}

/** What the form fills in when a past customer is chosen. */
export type ReusedCustomer = {
  name: string
  phone: string
  phoneAlt: string
  address: string
  areaId: string
  /** Null when that past order had no pin — see the note at the mapping. */
  point: { lat: number; lng: number } | null
  note: string
}

export function reuse(customer: PastOrderRow): ReusedCustomer {
  return {
    name: customer.customer_name,
    phone: customer.customer_phone,
    phoneAlt: customer.customer_phone_alt ?? '',
    address: customer.dropoff_address,
    areaId: customer.dropoff_area_id ?? '',
    /*
      NULL WHEN THAT PAST ORDER HAD NO PIN, which 0037 made possible. Reusing a
      customer is still the BEST case for coordinates -- if anyone ever placed a
      pin for this address, this is where it comes back from -- but it is no
      longer a guarantee, and inventing `{ lat: null }` here would put half a
      point into the form.
    */
    point:
      customer.dropoff_lat === null || customer.dropoff_lng === null
        ? null
        : { lat: customer.dropoff_lat, lng: customer.dropoff_lng },
    note: customer.dropoff_note ?? '',
  }
}
