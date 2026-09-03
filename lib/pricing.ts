import type { Mmk } from '@/types/domain'

/**
 * Fee and commission arithmetic. Everything here is integer MMK.
 *
 * The single rounding rule: the rider's cut is FLOORed and the platform takes
 * the remainder. That guarantees rider + platform === fee exactly, which is
 * what the SQL CHECK `orders_commission_split_sane` enforces. If you round both
 * halves independently you will eventually be one kyat off and the constraint
 * will reject the assignment.
 */

/**
 * Distance quoting was REMOVED in the shop-panel round.
 *
 * `quoteFee` priced a parcel as base + per-km past a free allowance. Shops are
 * now charged a flat `routes.per_parcel_fee` chosen by the destination area
 * (`resolveAreaRoute` in lib/orders/queries.ts), because the two models
 * disagreed badly — a Mingaladon parcel quoted 8,100 Ks against an official
 * 4,000 — and only one of them was the price the business had signed off.
 *
 * `app_settings.base_delivery_fee`, `per_km_fee`, `free_km` and `road_factor`
 * are the columns it read. They are still in the schema and are no longer read
 * by anything.
 */

export type CommissionSplit = { riderPct: number; rider: Mmk; platform: Mmk }

/** Mirrors SQL `assign_order`: floor(fee * pct / 100), platform takes the rest. */
export function splitCommission(fee: Mmk, riderPct: number): CommissionSplit {
  const rider = Math.floor((fee * riderPct) / 100)
  return { riderPct, rider, platform: fee - rider }
}

/**
 * What the rider actually collects at the door. Only meaningful for COD, and it
 * is the number that must end up in orders.cod_amount -- see the column comment
 * in migration 0001: cod_amount is goods + fee when the customer pays the fee,
 * so settlement never has to branch on fee_payer.
 */
export function codCollectable(
  goodsValue: Mmk,
  deliveryFee: Mmk,
  feePayer: 'customer' | 'shop',
): Mmk {
  return feePayer === 'customer' ? goodsValue + deliveryFee : goodsValue
}

/**
 * The inverse of `codCollectable`, for showing a rider what they are collecting
 * and why.
 *
 * WHY THIS IS NOT "delivery fee + COD". `orders.cod_amount` ALREADY CONTAINS the
 * delivery fee when the customer pays it — see the column comment in 0001 and
 * `codCollectable` above, which exists so settlement never has to branch on
 * fee_payer. Adding the two on screen would show the rider a total 3,500 Ks
 * higher than the customer actually owes, and a rider who trusts the screen
 * would collect it.
 *
 * So the fee is SUBTRACTED back out to recover the goods value, and the three
 * numbers are presented as a breakdown that sums to `cod_amount` exactly.
 */
export function codBreakdown(
  codAmount: Mmk,
  deliveryFee: Mmk,
  feePayer: 'customer' | 'shop',
  paymentMethod: 'cod' | 'prepaid' = 'cod',
): { goods: Mmk; fee: Mmk; total: Mmk; feeFromCustomer: boolean } {
  if (paymentMethod !== 'cod') {
    // Nothing to collect. The fee is still real, it is just billed to the shop
    // rather than taken at the door.
    return { goods: 0, fee: deliveryFee, total: 0, feeFromCustomer: false }
  }
  const feeFromCustomer = feePayer === 'customer'
  const fee = feeFromCustomer ? deliveryFee : 0
  return {
    // Clamped: a fee edited upward after the order was priced must not render a
    // negative goods value.
    goods: Math.max(0, codAmount - fee),
    fee,
    total: codAmount,
    feeFromCustomer,
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

// ---------------------------------------------------------------------------
// Route trip pay  (Ways ၁–၄, `routes.pay_model = 'trip'`)
//
// The TypeScript twin of SQL `quote_trip_pay()`. It exists so the planning board
// can preview the exact figure `close_trip()` will book, and so the contested
// tier arithmetic is pinned by unit tests rather than discovered in a payout
// dispute. When one side changes, change both -- `splitCommission` above mirrors
// `assign_order` the same way.
// ---------------------------------------------------------------------------

/** A row of `route_pay_tiers`. `maxParcels: null` means open-ended. */
export type RoutePayTier = {
  minParcels: number
  maxParcels: number | null
  basePay: Mmk
  /**
   * `null`/absent = a global default applying to every trip-paid route. A tier
   * naming a route overrides the global one covering the same parcel count,
   * which is why the SQL exclusion constraint permits that one overlap.
   */
  routeId?: string | null
}

export type TripPayRates = {
  /** `app_settings.route_parcel_rate` — added for EVERY parcel, not just those above the tier floor. */
  parcelRate: Mmk
  /** `app_settings.route_pickup_rate` — per parcel collected on the return leg. */
  pickupRate: Mmk
}

export type TripPayQuote = {
  parcels: number
  pickups: number
  /** The tier that applied, or null when no tier covers this count. */
  tier: RoutePayTier | null
  basePay: Mmk
  parcelPay: Mmk
  pickupPay: Mmk
  total: Mmk
}

/**
 * The tier covering `parcels`, or null.
 *
 * A route-specific tier beats a global one for the same count -- that is the
 * whole point of the override, and the SQL exclusion constraint permits exactly
 * that overlap and no other.
 *
 * Sorted defensively rather than trusting input order: within one scope the
 * constraint guarantees at most one match, but a caller passing tiers in
 * arbitrary order must still get the same answer.
 */
export function pickPayTier(
  parcels: number,
  tiers: RoutePayTier[],
  routeId?: string | null,
): RoutePayTier | null {
  const n = normaliseCount(parcels)
  const covering = [...tiers]
    .sort((a, b) => a.minParcels - b.minParcels)
    .filter((t) => n >= t.minParcels && (t.maxParcels === null || n <= t.maxParcels))

  if (routeId) {
    const override = covering.find((t) => t.routeId === routeId)
    if (override) return override
  }
  return covering.find((t) => t.routeId === null || t.routeId === undefined) ?? null
}

/**
 * base(parcel count) + (parcels × parcelRate) + (pickups × pickupRate)
 *
 * The per-parcel rate applies to the FULL count, so base and per-parcel both
 * scale with volume -- 20 parcels is 20,000 + 6,000 = 26,000, not 20,000. That
 * reading was ambiguous in the original spec (which also said "at least 20 ->
 * 15,000"); it is settled here and pinned in pricing.test.ts.
 *
 * A count with no covering tier yields `tier: null` and a zero base rather than
 * throwing: the caller is mid-payout and a visible 0 base is easier to spot and
 * correct than an exception that aborts closing the run. The seeded tiers cover
 * 0..infinity, so this should be unreachable.
 */
export function quoteTripPay(
  parcels: number,
  pickups: number,
  tiers: RoutePayTier[],
  rates: TripPayRates,
  routeId?: string | null,
): TripPayQuote {
  const p = normaliseCount(parcels)
  const u = normaliseCount(pickups)

  const tier = pickPayTier(p, tiers, routeId)
  const basePay = tier?.basePay ?? 0
  const parcelPay = p * Math.max(0, Math.trunc(rates.parcelRate))
  const pickupPay = u * Math.max(0, Math.trunc(rates.pickupRate))

  return {
    parcels: p,
    pickups: u,
    tier,
    basePay,
    parcelPay,
    pickupPay,
    total: basePay + parcelPay + pickupPay,
  }
}

/**
 * The official per-parcel delivery fee schedule, in MMK.
 *
 * The database is the source of truth (`routes.per_parcel_fee`, seeded in
 * migration 0007); this mirror exists so the numbers can be asserted in a unit
 * test and used in previews without a round trip. `pricing.test.ts` fails if the
 * two disagree, which is the only thing that stops them drifting.
 */
export const OFFICIAL_ROUTE_FEES = {
  /** သင်္ဃန်းကျွန်း, base to base */
  ROUTE_LOCAL: 2500,
  /** Downtown / ဆူးလေ */
  ROUTE_A: 3500,
  /** လှည်းတန်း / West */
  ROUTE_B: 3500,
  /** မြောက်ဥက္ကလာ / မင်္ဂလာဒုံ */
  ROUTE_C: 4000,
  /** ဒဂုံ townships / ဆိပ်ကမ်း */
  ROUTE_D: 4000,
} as const

export type RouteCode = keyof typeof OFFICIAL_ROUTE_FEES

/** What a shop is charged for `parcels` on a route. Flat per parcel, no distance. */
export function quoteRouteFee(parcels: number, perParcelFee: Mmk): Mmk {
  return normaliseCount(parcels) * Math.max(0, Math.trunc(perParcelFee))
}

/**
 * The smallest parcel count at which a run stops losing money.
 *
 * Trip pay starts at a flat base, so a short run is paid far more than it earns:
 * at the local 2,500 Ks fee a six-parcel run costs 16,800 in pay against 15,000
 * in revenue. This is the number to put in front of a dispatcher before they
 * send a half-empty van out.
 *
 * Returns the FIRST break-even count. Because the base is a step function, a
 * large enough jump at a tier boundary could in principle dip back below
 * break-even above this point — with the current schedule none does, and
 * pricing.test.ts asserts that.
 */
export function breakEvenParcels(
  perParcelFee: Mmk,
  tiers: RoutePayTier[],
  rates: TripPayRates,
  maxParcels = 200,
): number | null {
  for (let n = 1; n <= maxParcels; n += 1) {
    if (quoteRouteFee(n, perParcelFee) >= quoteTripPay(n, 0, tiers, rates).total) return n
  }
  return null
}

export type RouteMargin = {
  revenue: Mmk
  riderPay: Mmk
  platform: Mmk
  /** Rider's share of revenue, 0–100, one decimal. Negative platform → over 100. */
  riderSharePct: number
}

/**
 * What the platform actually keeps on a run.
 *
 * Worth surfacing in the admin UI because trip pay makes margin a RESIDUAL, not
 * a percentage: the same formula pays a rider ~84% of revenue at 1,500 Ks per
 * parcel and ~42% at 3,000 Ks. A flat fee set without checking this against the
 * tiers is how a route quietly runs at a loss.
 */
export function routeMargin(parcels: number, perParcelFee: Mmk, riderPay: Mmk): RouteMargin {
  const revenue = quoteRouteFee(parcels, perParcelFee)
  const platform = revenue - riderPay
  return {
    revenue,
    riderPay,
    platform,
    riderSharePct: revenue === 0 ? 0 : Math.round((riderPay / revenue) * 1000) / 10,
  }
}

// ---------------------------------------------------------------------------
// Trip volume — the 20-parcel operational rule
//
// TWO DIFFERENT THRESHOLDS, deliberately not collapsed into one boolean:
//
//   break-even  5-7 parcels   the point where revenue covers the rider's pay
//   minimum     20 parcels    the business rule for a run being worth sending
//
// A 12-parcel run is PROFITABLE but BELOW MINIMUM. Reporting that as
// "unprofitable" would be false, and a dispatcher who learns the warning lies
// starts ignoring it — including at 6 parcels, where it is telling the truth.
// ---------------------------------------------------------------------------

/** The operational floor for dispatching a run, per the business rule. */
export const MIN_PARCELS_PER_TRIP = 20

export type TripVolumeSeverity = 'ok' | 'below_minimum' | 'loss'

export type TripVolumeCheck = {
  parcels: number
  minimum: number
  meetsMinimum: boolean
  /** Smallest count at which this route stops losing money, or null if never. */
  breakEven: number | null
  /** Revenue covers the rider's trip pay. */
  profitable: boolean
  margin: RouteMargin
  severity: TripVolumeSeverity
  /** Banner copy, or null when the run is fine. */
  message: string | null
}

/**
 * Grade a trip's loaded volume for the dispatcher board.
 *
 * `loss` outranks `below_minimum`: if a run is actually losing money that is the
 * more urgent thing to say, and it is a strictly smaller set of cases.
 */
export function checkTripVolume(
  parcels: number,
  perParcelFee: Mmk,
  tiers: RoutePayTier[],
  rates: TripPayRates,
  routeId?: string | null,
  /**
   * The live threshold, from `app_settings.min_parcels_per_trip`.
   *
   * MUST come from the database wherever one is available. `depart_trip()` reads
   * that column, so a board that warned at a different number would tell a
   * dispatcher a run is fine and then refuse to send it — the exact failure a
   * shared constant is supposed to prevent. The constant is only the default for
   * previews and tests.
   */
  minimum: number = MIN_PARCELS_PER_TRIP,
): TripVolumeCheck {
  const n = normaliseCount(parcels)
  const floor = normaliseCount(minimum)
  const pay = quoteTripPay(n, 0, tiers, rates, routeId).total
  const margin = routeMargin(n, perParcelFee, pay)
  const profitable = margin.platform >= 0
  const meetsMinimum = n >= floor

  const severity: TripVolumeSeverity = !profitable
    ? 'loss'
    : meetsMinimum
      ? 'ok'
      : 'below_minimum'

  const message =
    severity === 'loss'
      ? `Running at a loss: ${n}/${floor} parcels — pay ${pay.toLocaleString()} Ks against ${margin.revenue.toLocaleString()} Ks of fees`
      : severity === 'below_minimum'
        ? `Under Minimum Volume: ${n}/${floor} Parcels`
        : null

  return {
    parcels: n,
    minimum: floor,
    meetsMinimum,
    breakEven: breakEvenParcels(perParcelFee, tiers, rates),
    profitable,
    margin,
    severity,
    message,
  }
}

/** Everything `isTripProfitable` needs to price a route it is only given the id of. */
export type TripPricingContext = {
  routes: ReadonlyArray<{ id: string; perParcelFee: Mmk }>
  tiers: RoutePayTier[]
  rates: TripPayRates
}

/**
 * Does this run's revenue cover the rider's pay?
 *
 * Note this answers ONLY the money question, not the 20-parcel rule -- a
 * 12-parcel run returns true. Use `checkTripVolume` for the board banner, which
 * grades both. Returns false for an unknown route, since a run that cannot be
 * priced cannot be shown to be profitable.
 */
export function isTripProfitable(
  parcelCount: number,
  routeId: string,
  ctx: TripPricingContext,
): boolean {
  const route = ctx.routes.find((r) => r.id === routeId)
  if (!route) return false
  return checkTripVolume(parcelCount, route.perParcelFee, ctx.tiers, ctx.rates, routeId).profitable
}

/** Counts are integers >= 0 in the schema; mirror that instead of trusting input. */
const normaliseCount = (n: number) =>
  Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
