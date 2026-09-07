/**
 * What a run earns us per parcel, for the profitability pill, the break-even
 * banner and the Super Admin pricing preview.
 *
 * WHY THIS IS NOT `routes.per_parcel_fee` ANY MORE. 0033 moved the customer
 * price to the destination area's zone, because a route bundles townships and
 * one that reaches both a 4,000 Ks township and a 5,000 Ks industrial pocket
 * cannot express a single price. The route's own figure was left in place — it
 * is still the signed-off planning schedule — but it stopped being what anyone
 * is billed. Reading it here understated a ROUTE_LOCAL run by 1,500 Ks a
 * parcel: 50,000 Ks of revenue shown against 80,000 actually charged on a
 * 20-parcel run, and break-even reported as 7 parcels instead of 5. A
 * dispatcher would have held back runs that were comfortably profitable.
 *
 * WHY THE LOWEST FEE AND NOT THE AVERAGE. A route spanning two bands has no
 * single correct number, and the two directions of error are not symmetric:
 *
 *   understate  a profitable run goes out carrying a warning     recoverable
 *   overstate   an unprofitable run goes out carrying none       not
 *
 * So take the pessimistic one. It is also stable — adding a cheaper area to a
 * route can only lower the figure, never quietly raise it past a threshold.
 *
 * PRIMARY MAPPINGS ONLY, because those are the ones that bill. A parcel rides
 * its area's primary route (`route_areas_primary_uk` enforces exactly one), and
 * that is the route whose run it counts toward.
 */

/** The shape both callers already fetch. Only the fields this needs. */
export type PrimaryAreaFeeRow = {
  route_id: string
  is_primary: boolean
  service_areas: unknown
}

export function planningFeeByRoute(
  rows: ReadonlyArray<PrimaryAreaFeeRow>,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    if (!row.is_primary) continue
    const area = row.service_areas as { delivery_zones?: { fee?: number } | null } | null
    const fee = area?.delivery_zones?.fee
    // A missing or non-numeric fee is skipped rather than treated as zero. Zero
    // is a legitimate fee (a promotional free zone), so coercing an absent one
    // to it would report a real route as making no money at all — and the
    // caller's fallback to the route's own figure is the better wrong answer.
    if (typeof fee !== 'number' || !Number.isFinite(fee)) continue
    const seen = out.get(row.route_id)
    out.set(row.route_id, seen === undefined ? fee : Math.min(seen, fee))
  }
  return out
}
