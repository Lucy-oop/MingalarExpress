import type { LatLng } from '@/types/domain'

/**
 * Great-circle distance helpers.
 *
 * Division of labour: PostGIS does the *filtering* (indexed ST_DWithin in
 * `nearby_available_riders`), this file does the *presentation and scoring*.
 * Never use these to filter hundreds of riders in JS -- that is what the GiST
 * index is for.
 */

const EARTH_RADIUS_KM = 6371.0088 // IUGG mean radius

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  // Math.min guards against a >1 argument from floating-point drift at
  // antipodal points, which would make asin() return NaN.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Equirectangular approximation. ~0.1% error at Thingangyun's latitude over
 * <10 km, and materially cheaper -- use it when re-sorting markers on every map
 * pan, not for anything a rider gets paid on.
 */
export function fastDistanceKm(a: LatLng, b: LatLng): number {
  const x = toRad(b.lng - a.lng) * Math.cos(toRad((a.lat + b.lat) / 2))
  const y = toRad(b.lat - a.lat)
  return Math.hypot(x, y) * EARTH_RADIUS_KM
}

/**
 * Yangon's block grid makes ridden distance ~1.35x crow-fly. This is a tuning
 * constant, not physics: the authoritative value lives in
 * app_settings.road_factor so ops can adjust it without a deploy.
 */
export const DEFAULT_ROAD_FACTOR = 1.35

export const roadKm = (crowKm: number, factor: number = DEFAULT_ROAD_FACTOR) => crowKm * factor

/** Motorbike ETA in minutes. 18 km/h is realistic Yangon traffic, not free-flow. */
export function etaMinutes(
  crowKm: number,
  { avgKmh = 18, bufferMin = 4, roadFactor = DEFAULT_ROAD_FACTOR } = {},
): number {
  return Math.round((roadKm(crowKm, roadFactor) / avgKmh) * 60 + bufferMin)
}
