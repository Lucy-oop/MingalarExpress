import { haversineKm } from '@/lib/geo/haversine'
import type { LatLng } from '@/types/domain'

/**
 * The order a rider actually drives, centred on the Thingangyun hub.
 *
 *   deliveries   nearest the hub first, working outwards
 *   pickups      farthest first, working back in
 *
 * So the run is a loop: out through the deliveries, then home through the
 * collections, finishing beside the hub with the cash and the collected parcels.
 * The alternative — pickups in the same outward order — ends the day at the far
 * edge of the city holding everything, which is both a longer ride home and the
 * worst possible place to be carrying the day's COD.
 *
 * WHY THIS REPLACES `route_areas.stop_order`. That is a per-AREA sequence a
 * dispatcher maintains by hand, and it cannot know which parcels are actually on
 * today's run or where inside an area they sit. This measures the parcels that
 * are on the bike. `stop_order` is still shown on the card as the area's place
 * in the route.
 *
 * WHY STRAIGHT-LINE DISTANCE. Yangon's road network is not a grid and the
 * honest answer needs routing (OSRM) — noted as deferred. Straight-line from a
 * single hub still gets the ORDER right in nearly every case, because the thing
 * being sorted is radial distance from one point, and it costs no API call on a
 * phone with two bars.
 */

/** The hub: Thingangyun. Overridden per run by `routes.hub_lat/hub_lng`. */
export const DEFAULT_HUB: LatLng = { lat: 16.8409, lng: 96.1735 }

export type Routable = {
  id: string
  code: string
  leg?: 'delivery' | 'pickup' | 'return' | null
  /** Where the rider is going for THIS parcel — already flipped for a return. */
  destination: LatLng | null
  /**
   * The office's own position for this parcel's AREA on its route, from
   * `route_areas.stop_order`.
   *
   * THE FALLBACK THAT KEEPS AN UNPINNED RUN A ROUTE. 0037 made the dropoff pin
   * optional, because most Yangon addresses do not geocode and asking a shop to
   * place one asked it to guess. But a stop with no coordinates cannot be
   * measured from the hub, and twenty unmeasurable stops ordered by order code
   * is not a route, it is a list.
   *
   * This is coarser than metres and better than nothing: a human sequenced
   * these wards for this route deliberately.
   */
  stopOrder?: number | null
}

export type Sorted<T> = T & { hubKm: number | null; stopNumber: number }

/**
 * A return rides home with the collections: its destination is the shop, and
 * finishing near the hub is the same win.
 */
function isOutbound(leg: Routable['leg']): boolean {
  return leg !== 'pickup' && leg !== 'return'
}

export function sortRoute<T extends Routable>(jobs: T[], hub: LatLng = DEFAULT_HUB): Array<Sorted<T>> {
  const measured = jobs.map((j) => ({
    job: j,
    // Null when the parcel has no coordinates — ordinary since 0037. See `rank`
    // for what orders those instead.
    hubKm: j.destination ? haversineKm(hub, j.destination) : null,
  }))

  const rank = (a: (typeof measured)[number], b: (typeof measured)[number], outward: boolean) => {
    /*
      BOTH UNMEASURABLE: fall back to the office's ward sequence for the route
      before falling back to the order code. Since 0037 this is the ordinary
      case for a run of parcels the geocoder could not place, and `stop_order`
      is the only human-chosen sequence available. Code is the last resort and
      means "we genuinely have nothing" — it exists to keep the list STABLE
      between refreshes rather than to be a route.
    */
    if (a.hubKm === null && b.hubKm === null) {
      const sa = a.job.stopOrder
      const sb = b.job.stopOrder
      if (typeof sa === 'number' && typeof sb === 'number' && sa !== sb) return sa - sb
      if (typeof sa === 'number' && typeof sb !== 'number') return -1
      if (typeof sa !== 'number' && typeof sb === 'number') return 1
      return a.job.code.localeCompare(b.job.code)
    }
    /*
      MEASURED BEFORE UNMEASURED, whichever direction. A stop we can place goes
      in its right position; one we cannot keeps its place at the end of its own
      group rather than being dropped or sorted to the front — it still has to
      be delivered, and a rider must never lose a stop to missing data.
    */
    if (a.hubKm === null) return 1
    if (b.hubKm === null) return -1
    const d = outward ? a.hubKm - b.hubKm : b.hubKm - a.hubKm
    // Ties broken by code so the list is stable between refreshes. A list that
    // reshuffles on its own is a list a rider stops trusting.
    return d !== 0 ? d : a.job.code.localeCompare(b.job.code)
  }

  const deliveries = measured.filter((m) => isOutbound(m.job.leg)).sort((a, b) => rank(a, b, true))
  const collections = measured.filter((m) => !isOutbound(m.job.leg)).sort((a, b) => rank(a, b, false))

  return [...deliveries, ...collections].map((m, i) => ({
    ...m.job,
    hubKm: m.hubKm,
    stopNumber: i + 1,
  }))
}
