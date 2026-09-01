import {
  THINGANGYUN_CENTER,
  THINGANGYUN_SEARCH_BBOX,
  isInServiceArea,
} from '@/lib/geo/thingangyun'
import type { LatLng } from '@/types/domain'

/**
 * Geocoding — address to point (forward) and point to address (reverse).
 *
 * Configured INDEPENDENTLY of tiles (./providers). They are separate products
 * even when bought from the same vendor, and plenty of sensible setups mix
 * them: self-hosted tiles with a hosted geocoder, or MapTiler tiles with a
 * self-hosted Nominatim. `NEXT_PUBLIC_MAP_PROVIDER` therefore says nothing
 * about which geocoder is in use; `NEXT_PUBLIC_GEOCODER_PROVIDER` does.
 */

/** Mirrors the CHECK on `app_settings.geocoder_provider`. */
export type GeocoderProviderKey = 'nominatim' | 'maptiler' | 'geoapify' | 'self_hosted'

/** How many suggestions the dropdown will ever show. */
export const SEARCH_LIMIT = 6

/** Below this, a query is too vague to spend a request on. */
export const MIN_QUERY_LENGTH = 3

type ForwardArgs = { query: string; baseUrl: string; apiKey: string; limit: number }
type ReverseArgs = { lat: number; lng: number; baseUrl: string; apiKey: string }

/** Provider-shaped result, before service-area classification. */
type RawCandidate = {
  id: string
  /** Full formatted address. */
  label: string
  /** Just the feature's own name — "Thitsar Road", not the whole address. */
  name: string
  point: LatLng
}

type GeocoderAdapter = {
  defaultBaseUrl: string
  requiresKey: boolean
  reverseUrl: (args: ReverseArgs) => URL
  parseReverse: (json: unknown) => string | null
  forwardUrl: (args: ForwardArgs) => URL
  parseForward: (json: unknown) => RawCandidate[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Join a path onto a base URL *without* discarding the base's own path.
 *
 * `new URL('/reverse', 'https://host/nominatim')` resolves to
 * `https://host/reverse` — the leading slash makes it absolute and the
 * `/nominatim` prefix silently disappears. That breaks every self-hosted
 * deployment served under a sub-path, which is the common case.
 */
function joinUrl(baseUrl: string, path: string): URL {
  const base = baseUrl.replace(/\/+$/, '')
  return new URL(`${base}/${path.replace(/^\/+/, '')}`)
}

/** ~11 cm. Trims pointless float noise off the URL and helps upstream caching. */
const coord = (n: number) => Number(n.toFixed(6))

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v : null

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Nominatim
// ---------------------------------------------------------------------------

const NOMINATIM: GeocoderAdapter = {
  defaultBaseUrl: 'https://nominatim.openstreetmap.org',
  requiresKey: false,

  reverseUrl: ({ lat, lng, baseUrl }) => {
    const url = joinUrl(baseUrl, 'reverse')
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('lat', String(lat))
    url.searchParams.set('lon', String(lng))
    url.searchParams.set('zoom', '18')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('accept-language', 'en')
    return url
  },

  parseReverse: (json) => str((json as { display_name?: unknown } | null)?.display_name),

  forwardUrl: ({ query, baseUrl, limit }) => {
    const url = joinUrl(baseUrl, 'search')
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('accept-language', 'en')
    url.searchParams.set('countrycodes', 'mm')
    /**
     * Nominatim's viewbox is <left>,<top>,<right>,<bottom> — that is
     * minLng,maxLat,maxLng,minLat, which is NOT the [minLng,minLat,maxLng,maxLat]
     * order MapTiler and GeoJSON use. Getting this wrong yields an inverted box
     * and zero results, silently.
     */
    url.searchParams.set(
      'viewbox',
      [
        THINGANGYUN_SEARCH_BBOX.west,
        THINGANGYUN_SEARCH_BBOX.north,
        THINGANGYUN_SEARCH_BBOX.east,
        THINGANGYUN_SEARCH_BBOX.south,
      ].join(','),
    )
    url.searchParams.set('bounded', '1')
    return url
  },

  parseForward: (json) => {
    if (!Array.isArray(json)) return []
    const out: RawCandidate[] = []
    for (const row of json) {
      const r = row as Record<string, unknown>
      const label = str(r.display_name)
      const lat = num(r.lat)
      const lng = num(r.lon)
      if (!label || lat === null || lng === null) continue
      out.push({
        id: String(r.place_id ?? `${lat},${lng}`),
        label,
        name: str(r.name) ?? label.split(',')[0]!.trim(),
        point: { lat, lng },
      })
    }
    return out
  },
}

// ---------------------------------------------------------------------------
// MapTiler
// ---------------------------------------------------------------------------

/**
 * MapTiler Geocoding API.
 *
 * Shape differs from Nominatim in ways that all have to be handled here, which
 * is the whole reason an adapter exists rather than just a base URL:
 *
 *   1. The subject goes in the PATH, not the query string — coordinates as
 *      `{lng},{lat}.json` (longitude FIRST), a search term as `{query}.json`.
 *      Everything on the TypeScript side of this codebase passes {lat, lng} in
 *      that order, so this is the one place the pair gets swapped. (PostGIS
 *      agrees with MapTiler: `st_makepoint` is also lng-first.)
 *   2. The key is a `key` query parameter, not a header.
 *   3. Responses are GeoJSON — `features[].place_name` and `features[].center`,
 *      and `center` is [lng, lat], swapped again.
 *
 * https://docs.maptiler.com/cloud/api/geocoding/
 */
const MAPTILER: GeocoderAdapter = {
  defaultBaseUrl: 'https://api.maptiler.com/geocoding',
  requiresKey: true,

  reverseUrl: ({ lat, lng, baseUrl, apiKey }) => {
    const url = joinUrl(baseUrl, `${coord(lng)},${coord(lat)}.json`)
    url.searchParams.set('key', apiKey)
    url.searchParams.set('language', 'en')
    // One result is all the address field can show; asking for fewer keeps the
    // response small on a phone tethered to patchy mobile data.
    url.searchParams.set('limit', '1')
    return url
  },

  parseReverse: (json) => {
    const first = firstFeature(json)
    return first ? (str(first.place_name) ?? str(first.text)) : null
  },

  forwardUrl: ({ query, baseUrl, apiKey, limit }) => {
    // The query is a path segment, so it MUST be encoded — an unescaped '/' in
    // "No. 12/A Thitsar Road" would otherwise change the request path.
    const url = joinUrl(baseUrl, `${encodeURIComponent(query)}.json`)
    url.searchParams.set('key', apiKey)
    url.searchParams.set('language', 'en')
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('country', 'mm')
    // bbox is minLng,minLat,maxLng,maxLat — restricts the result set.
    url.searchParams.set(
      'bbox',
      [
        THINGANGYUN_SEARCH_BBOX.west,
        THINGANGYUN_SEARCH_BBOX.south,
        THINGANGYUN_SEARCH_BBOX.east,
        THINGANGYUN_SEARCH_BBOX.north,
      ].join(','),
    )
    // Ordering hint on top of the hard bbox filter: ties break toward the
    // township centre rather than alphabetically.
    url.searchParams.set('proximity', `${THINGANGYUN_CENTER.lng},${THINGANGYUN_CENTER.lat}`)
    url.searchParams.set('autocomplete', 'true')
    return url
  },

  parseForward: (json) => {
    const body = json as { features?: unknown } | null
    if (!Array.isArray(body?.features)) return []
    const out: RawCandidate[] = []
    for (const raw of body.features) {
      const f = raw as Record<string, unknown>
      const center = f.center
      if (!Array.isArray(center) || center.length < 2) continue
      const lng = num(center[0])
      const lat = num(center[1])
      const label = str(f.place_name) ?? str(f.text)
      if (lat === null || lng === null || !label) continue
      out.push({
        id: String(f.id ?? `${lng},${lat}`),
        label,
        name: str(f.text) ?? label.split(',')[0]!.trim(),
        point: { lat, lng },
      })
    }
    return out
  },
}

function firstFeature(json: unknown): Record<string, unknown> | null {
  const body = json as { features?: unknown } | null
  if (!Array.isArray(body?.features) || body.features.length === 0) return null
  return body.features[0] as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * `self_hosted` maps to the Nominatim adapter on purpose: a self-hosted
 * geocoder in this stack means a Nominatim instance, which is protocol
 * identical. Only the base URL differs.
 *
 * `geoapify` has no adapter yet — it is allowed by the database CHECK but not
 * implemented here. Configuring it falls back to Nominatim, loudly.
 */
const GEOCODERS: Partial<Record<GeocoderProviderKey, GeocoderAdapter>> = {
  nominatim: NOMINATIM,
  self_hosted: NOMINATIM,
  maptiler: MAPTILER,
}

function isGeocoderKey(v: string | undefined): v is GeocoderProviderKey {
  return v === 'nominatim' || v === 'maptiler' || v === 'geoapify' || v === 'self_hosted'
}

export type ResolvedGeocoder = {
  key: GeocoderProviderKey
  adapter: GeocoderAdapter
  baseUrl: string
  apiKey: string
}

/**
 * Resolve the configured geocoder, falling back to Nominatim when the
 * configuration cannot work.
 *
 * The fallback is always announced. A silent downgrade to the public Nominatim
 * instance is a usage-policy breach that looks exactly like success, so a
 * misconfiguration has to be visible in the console rather than merely leaving
 * the address field blank.
 */
export function getGeocoder(): ResolvedGeocoder {
  const raw = process.env.NEXT_PUBLIC_GEOCODER_PROVIDER
  const requested: GeocoderProviderKey = isGeocoderKey(raw) ? raw : 'nominatim'
  // A geocoder key may be issued separately; most setups reuse the map key,
  // since both come from the same MapTiler account.
  const apiKey =
    process.env.NEXT_PUBLIC_GEOCODER_API_KEY || process.env.NEXT_PUBLIC_MAP_API_KEY || ''
  const configuredBase = process.env.NEXT_PUBLIC_GEOCODER_BASE_URL

  const fallback = (reason: string): ResolvedGeocoder => {
    console.error(`[geocoder] ${reason} Falling back to rate-limited public Nominatim.`)
    return { key: 'nominatim', adapter: NOMINATIM, baseUrl: NOMINATIM.defaultBaseUrl, apiKey: '' }
  }

  if (raw && !isGeocoderKey(raw)) {
    return fallback(`Unknown NEXT_PUBLIC_GEOCODER_PROVIDER "${raw}".`)
  }

  const adapter = GEOCODERS[requested]
  if (!adapter) return fallback(`Provider "${requested}" has no adapter implemented.`)

  if (adapter.requiresKey && !apiKey) {
    return fallback(
      `Provider "${requested}" requires NEXT_PUBLIC_GEOCODER_API_KEY or NEXT_PUBLIC_MAP_API_KEY.`,
    )
  }

  /**
   * A base URL left pointing at Nominatim while the provider says MapTiler is
   * the likeliest way to misconfigure this, because the two settings used to be
   * one. Requests would 404 forever and the address field would just stop
   * filling in, with nothing to explain why — so prefer the adapter's own
   * default and say what was ignored.
   */
  let baseUrl = adapter.defaultBaseUrl
  if (configuredBase) {
    if (looksCompatible(requested, configuredBase)) {
      baseUrl = configuredBase
    } else {
      console.error(
        `[geocoder] NEXT_PUBLIC_GEOCODER_BASE_URL "${configuredBase}" does not look like a ` +
          `"${requested}" endpoint; using ${adapter.defaultBaseUrl} instead.`,
      )
    }
  }

  return { key: requested, adapter, baseUrl, apiKey }
}

/**
 * Cheap sanity check, not validation. It only catches the one mistake that
 * actually happens — a leftover Nominatim URL under a MapTiler provider, or the
 * reverse — and lets anything else through so self-hosted endpoints on
 * arbitrary domains keep working.
 */
function looksCompatible(key: GeocoderProviderKey, baseUrl: string): boolean {
  const isNominatimHost = /nominatim/i.test(baseUrl)
  const isMapTilerHost = /api\.maptiler\.com/i.test(baseUrl)
  if (key === 'maptiler') return !isNominatimHost
  if (key === 'nominatim') return !isMapTilerHost
  return true
}

export function geocoderBaseUrl(): string {
  return getGeocoder().baseUrl
}

/**
 * NOT sent with requests, and cannot be.
 *
 * `User-Agent` is a forbidden header name, so a browser `fetch` silently drops
 * any attempt to set it. Nominatim's policy requirement for an identifying
 * User-Agent can therefore only be honoured by proxying through a server route.
 * The value is kept configurable for the day that proxy exists.
 */
export function geocoderUserAgent(): string {
  return process.env.NEXT_PUBLIC_GEOCODER_USER_AGENT ?? 'MingalarExpress/0.1'
}

// ---------------------------------------------------------------------------
// Reverse — point to address
// ---------------------------------------------------------------------------

export type ReverseGeocodeResult = { label: string; raw?: unknown }

/**
 * Reverse geocode a pin to a human address.
 *
 * Callers MUST debounce and pass an AbortSignal (LocationPicker waits for
 * drag-end plus 800 ms): the public Nominatim instance allows one request per
 * second, and a dragging pin would otherwise fire dozens and get the IP
 * blocked. MapTiler is far more permissive, but the debounce costs nothing and
 * the provider is a deploy-time setting.
 *
 * Failure is non-fatal by design: the address field stays editable and the shop
 * types it. A geocoder outage must never block order creation.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<ReverseGeocodeResult | null> {
  const { adapter, baseUrl, apiKey } = getGeocoder()

  let url: URL
  try {
    url = adapter.reverseUrl({ lat, lng, baseUrl, apiKey })
  } catch {
    // A malformed base URL would throw out of `new URL`. Treat it as a miss
    // rather than taking the order form down with it.
    return null
  }

  try {
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const json: unknown = await res.json()
    const label = adapter.parseReverse(json)
    return label ? { label, raw: json } : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Forward — address to point
// ---------------------------------------------------------------------------

export type GeocodeCandidate = {
  id: string
  /** Full formatted address, used as the address field value on selection. */
  label: string
  /** Short feature name, rendered as the first line of the suggestion. */
  name: string
  /** The remainder of the label, rendered muted underneath. */
  detail: string | null
  point: LatLng
  /**
   * False when the point lies outside the hard geofence.
   *
   * The search box is padded wider than `in_service_area()` on purpose (see
   * THINGANGYUN_SEARCH_BBOX), so a result CAN come back that the database would
   * refuse to store. Such a candidate is returned rather than dropped — knowing
   * the address was found but is out of area is far more useful than an empty
   * dropdown — and the UI renders it as unselectable.
   */
  inServiceArea: boolean
}

/**
 * Search an address, biased and restricted to Thingangyun.
 *
 * Returns `[]` for anything unusable — a short query, a provider error, an
 * aborted request. Search is a convenience over the map pin, never a
 * prerequisite, so it fails quietly in exactly the same way reverse geocoding
 * does.
 */
export async function forwardGeocode(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeCandidate[]> {
  const trimmed = query.trim()
  if (trimmed.length < MIN_QUERY_LENGTH) return []

  const { adapter, baseUrl, apiKey } = getGeocoder()

  let url: URL
  try {
    url = adapter.forwardUrl({ query: trimmed, baseUrl, apiKey, limit: SEARCH_LIMIT })
  } catch {
    return []
  }

  try {
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const json: unknown = await res.json()

    const seen = new Set<string>()
    const out: GeocodeCandidate[] = []

    for (const raw of adapter.parseForward(json)) {
      // Providers happily return the same place twice under different ids
      // (a POI and its address). Dedupe on the label a human would read.
      const dedupeKey = raw.label.toLowerCase()
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      out.push({
        ...raw,
        detail: detailOf(raw.name, raw.label),
        inServiceArea: isInServiceArea(raw.point),
      })
      if (out.length >= SEARCH_LIMIT) break
    }

    return out
  } catch {
    return []
  }
}

/** "Thitsar Road, Thingangyun, Yangon" minus its leading "Thitsar Road". */
function detailOf(name: string, label: string): string | null {
  if (!label.toLowerCase().startsWith(name.toLowerCase())) return label === name ? null : label
  const rest = label.slice(name.length).replace(/^\s*,\s*/, '').trim()
  return rest.length > 0 ? rest : null
}
