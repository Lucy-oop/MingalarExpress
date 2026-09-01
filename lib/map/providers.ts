/**
 * Pluggable TILE provider.
 *
 * Geocoding lives in ./geocoder -- deliberately a separate module with a
 * separate env var, because tiles and geocoding are separate products even when
 * bought from the same vendor. MapTiler tiles with a self-hosted Nominatim is a
 * perfectly ordinary setup.
 *
 * Development runs on raw OpenStreetMap with no API key. That is fine for
 * development and NOT fine for production: tile.openstreetmap.org forbids heavy
 * use.
 *
 * Switching provider is an env change, not a code change. Keys stay in env and
 * never in app_settings -- the DB row records *which* provider ops chose, the
 * secret lives in the environment.
 */

export type MapProviderKey = 'osm' | 'maptiler' | 'stadia' | 'geoapify' | 'self_hosted'

export type MapProvider = {
  key: MapProviderKey
  tileUrl: string
  attribution: string
  maxZoom: number
  /** True when the provider needs no key -- i.e. is rate-limited and dev-only. */
  unmetered: boolean
  requiresKey: boolean
}

const ATTRIB_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

const REGISTRY: Record<MapProviderKey, Omit<MapProvider, 'key' | 'tileUrl'> & { tile: string }> = {
  osm: {
    tile: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: ATTRIB_OSM,
    maxZoom: 19,
    unmetered: true,
    requiresKey: false,
  },
  maptiler: {
    tile: 'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key={key}',
    attribution: `&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> ${ATTRIB_OSM}`,
    maxZoom: 20,
    unmetered: false,
    requiresKey: true,
  },
  stadia: {
    tile: 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png?api_key={key}',
    attribution: `&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> ${ATTRIB_OSM}`,
    maxZoom: 20,
    unmetered: false,
    requiresKey: true,
  },
  geoapify: {
    tile: 'https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey={key}',
    attribution: `&copy; <a href="https://www.geoapify.com/">Geoapify</a> ${ATTRIB_OSM}`,
    maxZoom: 20,
    unmetered: false,
    requiresKey: true,
  },
  self_hosted: {
    tile: '',
    attribution: ATTRIB_OSM,
    maxZoom: 19,
    unmetered: true,
    requiresKey: false,
  },
}

function isProviderKey(v: string | undefined): v is MapProviderKey {
  return !!v && v in REGISTRY
}

export function getMapProvider(): MapProvider {
  const raw = process.env.NEXT_PUBLIC_MAP_PROVIDER
  const key: MapProviderKey = isProviderKey(raw) ? raw : 'osm'
  const entry = REGISTRY[key]
  const apiKey = process.env.NEXT_PUBLIC_MAP_API_KEY ?? ''
  const override = process.env.NEXT_PUBLIC_MAP_TILE_URL

  let tileUrl = override && override.length > 0 ? override : entry.tile
  if (entry.requiresKey) {
    if (!apiKey && process.env.NODE_ENV === 'production') {
      // Loud in production, silent fallback in dev: a keyless prod deploy would
      // otherwise render blank grey tiles with no explanation.
      console.error(
        `[map] provider "${key}" requires NEXT_PUBLIC_MAP_API_KEY; falling back to rate-limited OSM tiles.`,
      )
      return { key: 'osm', tileUrl: REGISTRY.osm.tile, ...stripTile(REGISTRY.osm) }
    }
    tileUrl = tileUrl.replace('{key}', apiKey)
  }

  if (!tileUrl) {
    return { key: 'osm', tileUrl: REGISTRY.osm.tile, ...stripTile(REGISTRY.osm) }
  }

  return { key, tileUrl, ...stripTile(entry) }
}

function stripTile(e: (typeof REGISTRY)[MapProviderKey]) {
  const { tile: _tile, ...rest } = e
  return rest
}
