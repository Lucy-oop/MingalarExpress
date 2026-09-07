import type { LatLng } from '@/types/domain'

/**
 * Greater Yangon service area — Thingangyun Base plus the townships on
 * Routes A–D.
 *
 * This bbox MUST stay in step with the SQL function `public.in_service_area()`
 * (widened in migration 0007). The SQL copy is the hard geofence -- a CHECK
 * constraint cannot read a table, so changing the area is a migration, not a
 * settings change. This copy exists so the UI can reject a pin before the
 * round-trip.
 *
 * It is a typo/wrong-hemisphere guard, NOT a statement of where we deliver.
 * Route membership is the real answer to that, and it lives in `route_areas`.
 * Bounds are driven by the extremes of the four routes, with padding:
 *
 *   south  ကျောက်တံတား / ဗိုလ်တထောင်  ~16.774
 *   north  မင်္ဂလာဒုံ                  ~17.00
 *   west   ကမရွတ်                      ~96.129
 *   east   ဒဂုံဆိပ်ကမ်း                ~96.32
 *
 * NAMING: the THINGANGYUN_* prefix is now inaccurate -- the area is city-wide
 * and only the hub is in Thingangyun. Renaming this module to `yangon.ts` is
 * pending; it touches eight importers and was deliberately not bundled with a
 * behaviour change.
 */
export const THINGANGYUN_BBOX = {
  south: 16.74,
  north: 17.02,
  // 0032 moved this from 96.05 to reach Hlaingtharyar, which sits around 96.03
  // and runs further west still. in_service_area(16.87, 96.03) was false, so a
  // shop could pick the ward and have the CHECK refuse the order.
  west: 95.95,
  east: 96.34,
} as const

/**
 * Bounding box handed to the geocoder when searching for an address.
 *
 * DELIBERATELY WIDER than THINGANGYUN_BBOX above. Two different jobs:
 *
 *   THINGANGYUN_BBOX        decides what may be SAVED. It mirrors the SQL CHECK
 *                           `in_service_area()`, so a point outside it cannot be
 *                           written at all.
 *   THINGANGYUN_SEARCH_BBOX decides what may be FOUND. Geocoder indexes place a
 *                           building's point wherever their data says, which for
 *                           an address on the township edge is regularly a few
 *                           hundred metres off. Clipping the search to the exact
 *                           geofence would hide those results entirely, so the
 *                           search box is padded and candidates that land
 *                           outside the real geofence are marked unusable
 *                           instead of being silently dropped.
 *
 * Order is [minLng, minLat, maxLng, maxLat] — the order both MapTiler's `bbox`
 * and GeoJSON use. Nominatim wants its own `viewbox` ordering; the adapter in
 * lib/map/geocoder.ts converts.
 */
export const THINGANGYUN_SEARCH_BBOX = {
  // Kept wider than THINGANGYUN_BBOX on every side — see the note above. Moved
  // with the west bound in 0032 so the gap survives.
  west: 95.9,
  south: 16.72,
  east: 96.37,
  north: 17.05,
} as const

export const THINGANGYUN_SEARCH_BBOX_TUPLE: readonly [number, number, number, number] = [
  THINGANGYUN_SEARCH_BBOX.west,
  THINGANGYUN_SEARCH_BBOX.south,
  THINGANGYUN_SEARCH_BBOX.east,
  THINGANGYUN_SEARCH_BBOX.north,
]

/** Thingangyun Base (စံပြဈေး) — the hub all four routes depart from. */
export const THINGANGYUN_CENTER: LatLng = { lat: 16.8478, lng: 96.1693 }

/** z14 framed one township; the served area is now city-wide. */
export const DEFAULT_ZOOM = 11

/** Leaflet wants [[south, west], [north, east]]. */
export const THINGANGYUN_LEAFLET_BOUNDS: [[number, number], [number, number]] = [
  [THINGANGYUN_BBOX.south, THINGANGYUN_BBOX.west],
  [THINGANGYUN_BBOX.north, THINGANGYUN_BBOX.east],
]

export function isInServiceArea(point: LatLng): boolean {
  return (
    point.lat >= THINGANGYUN_BBOX.south &&
    point.lat <= THINGANGYUN_BBOX.north &&
    point.lng >= THINGANGYUN_BBOX.west &&
    point.lng <= THINGANGYUN_BBOX.east
  )
}

export function mapDefaults() {
  const lat = Number(process.env.NEXT_PUBLIC_DEFAULT_CENTER_LAT)
  const lng = Number(process.env.NEXT_PUBLIC_DEFAULT_CENTER_LNG)
  const zoom = Number(process.env.NEXT_PUBLIC_DEFAULT_ZOOM)
  return {
    center:
      Number.isFinite(lat) && Number.isFinite(lng) ? ({ lat, lng } as LatLng) : THINGANGYUN_CENTER,
    zoom: Number.isFinite(zoom) ? zoom : DEFAULT_ZOOM,
  }
}
