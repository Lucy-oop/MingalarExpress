/**
 * Reading the destination area out of the address the shop already typed.
 *
 * WHY. The area dropdown carries 24 townships and it drives BOTH the price and
 * which run the parcel joins. On live data, three of nine orders had an area
 * that contradicted their own address — one undercharged by 500 Ks, and all
 * three would have ridden the wrong run: a parcel filed under Tamwe going out
 * on the Downtown route while the customer is on the eastern edge of the city.
 * A wasted leg costs far more than the fee difference.
 *
 * WHY THE ADDRESS AND NOT THE PIN. The obvious check is "which area centroid is
 * nearest the pin", and it is wrong. Measured against the same nine orders it
 * produced a FALSE POSITIVE: a genuinely-Bahan parcel sat 2.2 km from Bahan's
 * centroid but only 1.1 km from a Thingangyun ward's, so nearest-centroid would
 * have "corrected" it to a cheaper route and undercharged the shop. The
 * centroids are all flagged VERIFY-CENTROID in the seed — plausible points, not
 * survey data — and they are not fit to overrule a human.
 *
 * The address text got all nine right, and it has the property the centroid
 * lacks: the shop can SEE the evidence. "This address says Bahan" is checkable
 * by the person reading it.
 *
 * Pure, so the nine real orders serve as fixtures in area-match.test.ts.
 */

export type AreaLike = {
  areaId: string
  areaName: string
  areaNameMm?: string | null
}

export type AreaMatch = {
  /** The area the address points at, or null when it names none. */
  suggestedId: string | null
  /** Every area the address mentions, earliest first. */
  namedIds: string[]
  /**
   * The chosen area is set, the address names areas, and the chosen one is not
   * among them. Warn — never block: an address can legitimately mention a
   * neighbour ("near Bahan market, Yankin") and a shop must not be stopped.
   */
  contradicts: boolean
}

const EMPTY: AreaMatch = { suggestedId: null, namedIds: [], contradicts: false }

/**
 * Names short enough to appear inside unrelated words are skipped.
 *
 * A compound name is split, because "Kyauktada / Sule" is written as either half
 * in a real address.
 */
function needles(area: AreaLike): string[] {
  const out: string[] = []
  for (const raw of [area.areaName, area.areaNameMm ?? '']) {
    for (const part of raw.split('/')) {
      const clean = part.trim().toLowerCase()
      if (clean.length >= 3) out.push(clean)
    }
  }
  return out
}

export function matchAreaFromAddress(
  address: string,
  areas: AreaLike[],
  chosenId?: string | null,
): AreaMatch {
  const haystack = address.trim().toLowerCase()
  if (haystack.length === 0 || areas.length === 0) return EMPTY

  /**
   * Earliest mention wins.
   *
   * A reverse-geocoded address runs specific to general — "…, Bahan, Kamayut
   * District, Yangon City…" — so the township is always ahead of the district
   * it sits in. Taking the first match is what picks Bahan over Kamayut, and
   * getting that backwards would file every western parcel under its district.
   */
  const hits: Array<{ id: string; at: number }> = []
  for (const area of areas) {
    let earliest = -1
    for (const needle of needles(area)) {
      const at = haystack.indexOf(needle)
      if (at >= 0 && (earliest === -1 || at < earliest)) earliest = at
    }
    if (earliest >= 0) hits.push({ id: area.areaId, at: earliest })
  }

  if (hits.length === 0) return EMPTY
  hits.sort((a, b) => a.at - b.at)
  const namedIds = hits.map((h) => h.id)

  return {
    suggestedId: namedIds[0] ?? null,
    namedIds,
    // Named areas, and the shop picked one that is not among them.
    contradicts: !!chosenId && !namedIds.includes(chosenId),
  }
}
