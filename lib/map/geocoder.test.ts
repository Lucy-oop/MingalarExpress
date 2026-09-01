import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { forwardGeocode, getGeocoder, reverseGeocode } from './geocoder'

/**
 * These read `process.env` at call time, which is what the module does. In the
 * real build Next inlines `NEXT_PUBLIC_*` at compile time; here they are plain
 * environment variables, which is exactly what makes the resolution testable.
 */

const ENV_KEYS = [
  'NEXT_PUBLIC_GEOCODER_PROVIDER',
  'NEXT_PUBLIC_GEOCODER_BASE_URL',
  'NEXT_PUBLIC_GEOCODER_API_KEY',
  'NEXT_PUBLIC_MAP_API_KEY',
] as const

const saved: Record<string, string | undefined> = {}
let realFetch: typeof globalThis.fetch
let calls: string[] = []
/** Console noise is expected — the module announces every fallback. */
let realError: typeof console.error

function setEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k]
  for (const [k, v] of Object.entries(env)) process.env[k] = v
}

/** Stub fetch with a fixed JSON body, recording the URLs requested. */
function stubFetch(body: unknown, ok = true) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input))
    return {
      ok,
      json: async () => body,
    } as unknown as Response
  }) as typeof globalThis.fetch
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  realFetch = globalThis.fetch
  realError = console.error
  console.error = () => {}
  calls = []
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  globalThis.fetch = realFetch
  console.error = realError
})

// ---------------------------------------------------------------------------

describe('getGeocoder', () => {
  test('defaults to Nominatim when nothing is configured', () => {
    setEnv({})
    const g = getGeocoder()
    assert.equal(g.key, 'nominatim')
    assert.equal(g.baseUrl, 'https://nominatim.openstreetmap.org')
  })

  test('resolves MapTiler and reuses the map key', () => {
    setEnv({ NEXT_PUBLIC_GEOCODER_PROVIDER: 'maptiler', NEXT_PUBLIC_MAP_API_KEY: 'MAPKEY' })
    const g = getGeocoder()
    assert.equal(g.key, 'maptiler')
    assert.equal(g.apiKey, 'MAPKEY')
    assert.equal(g.baseUrl, 'https://api.maptiler.com/geocoding')
  })

  test('a dedicated geocoder key beats the map key', () => {
    setEnv({
      NEXT_PUBLIC_GEOCODER_PROVIDER: 'maptiler',
      NEXT_PUBLIC_MAP_API_KEY: 'MAPKEY',
      NEXT_PUBLIC_GEOCODER_API_KEY: 'GEOKEY',
    })
    assert.equal(getGeocoder().apiKey, 'GEOKEY')
  })

  /**
   * A silent downgrade to public Nominatim is a usage-policy breach that looks
   * exactly like success, so every one of these must be a visible fallback.
   */
  test('MapTiler with no key falls back to Nominatim', () => {
    setEnv({ NEXT_PUBLIC_GEOCODER_PROVIDER: 'maptiler' })
    assert.equal(getGeocoder().key, 'nominatim')
  })

  test('an unknown provider falls back to Nominatim', () => {
    setEnv({ NEXT_PUBLIC_GEOCODER_PROVIDER: 'google' })
    assert.equal(getGeocoder().key, 'nominatim')
  })

  test('geoapify is allowed by the DB CHECK but has no adapter — falls back', () => {
    setEnv({ NEXT_PUBLIC_GEOCODER_PROVIDER: 'geoapify', NEXT_PUBLIC_MAP_API_KEY: 'K' })
    assert.equal(getGeocoder().key, 'nominatim')
  })

  test('self_hosted uses the Nominatim protocol with a custom base', () => {
    setEnv({
      NEXT_PUBLIC_GEOCODER_PROVIDER: 'self_hosted',
      NEXT_PUBLIC_GEOCODER_BASE_URL: 'https://geo.mingalar.example/nominatim',
    })
    const g = getGeocoder()
    assert.equal(g.key, 'self_hosted')
    assert.equal(g.baseUrl, 'https://geo.mingalar.example/nominatim')
  })

  // The two settings used to be one, so a stale base URL is the likeliest
  // misconfiguration. It would 404 forever with nothing to explain why.
  test('a leftover Nominatim base URL under MapTiler is ignored, not used', () => {
    setEnv({
      NEXT_PUBLIC_GEOCODER_PROVIDER: 'maptiler',
      NEXT_PUBLIC_MAP_API_KEY: 'MAPKEY',
      NEXT_PUBLIC_GEOCODER_BASE_URL: 'https://nominatim.openstreetmap.org',
    })
    assert.equal(getGeocoder().baseUrl, 'https://api.maptiler.com/geocoding')
  })

  test('a MapTiler base URL under Nominatim is ignored too', () => {
    setEnv({
      NEXT_PUBLIC_GEOCODER_PROVIDER: 'nominatim',
      NEXT_PUBLIC_GEOCODER_BASE_URL: 'https://api.maptiler.com/geocoding',
    })
    assert.equal(getGeocoder().baseUrl, 'https://nominatim.openstreetmap.org')
  })
})

// ---------------------------------------------------------------------------

describe('reverseGeocode — MapTiler', () => {
  const FEATURE = {
    features: [{ place_name: 'Thitsar Road, Thingangyun, Yangon', text: 'Thitsar Road' }],
  }

  beforeEach(() => {
    setEnv({ NEXT_PUBLIC_GEOCODER_PROVIDER: 'maptiler', NEXT_PUBLIC_MAP_API_KEY: 'MAPKEY' })
  })

  /**
   * Longitude first, in the path. Everything on the TypeScript side of this
   * codebase passes {lat, lng} in that order, so a swap here is silent and
   * lands the pin in the Indian Ocean.
   */
  test('puts longitude BEFORE latitude in the path', async () => {
    stubFetch(FEATURE)
    await reverseGeocode(16.8409, 96.1735)
    assert.match(calls[0]!, /\/geocoding\/96\.1735,16\.8409\.json/)
  })

  test('sends the key, language and limit as query parameters', async () => {
    stubFetch(FEATURE)
    await reverseGeocode(16.8409, 96.1735)
    const url = new URL(calls[0]!)
    assert.equal(url.searchParams.get('key'), 'MAPKEY')
    assert.equal(url.searchParams.get('language'), 'en')
    assert.equal(url.searchParams.get('limit'), '1')
  })

  test('rounds coordinates to 6 decimal places', async () => {
    stubFetch(FEATURE)
    await reverseGeocode(16.840912345678, 96.173512345678)
    assert.match(calls[0]!, /96\.173512,16\.840912\.json/)
  })

  test('reads the label from features[0].place_name', async () => {
    stubFetch(FEATURE)
    const r = await reverseGeocode(16.84, 96.17)
    assert.equal(r?.label, 'Thitsar Road, Thingangyun, Yangon')
  })

  test('falls back to features[0].text when place_name is absent', async () => {
    stubFetch({ features: [{ text: 'Thitsar Road' }] })
    assert.equal((await reverseGeocode(16.84, 96.17))?.label, 'Thitsar Road')
  })

  test('an empty feature list is a miss, not a crash', async () => {
    stubFetch({ features: [] })
    assert.equal(await reverseGeocode(16.84, 96.17), null)
  })

  test('a Nominatim-shaped body yields null rather than a bogus label', async () => {
    stubFetch({ display_name: 'somewhere' })
    assert.equal(await reverseGeocode(16.84, 96.17), null)
  })

  test('a non-200 response is a miss', async () => {
    stubFetch(FEATURE, false)
    assert.equal(await reverseGeocode(16.84, 96.17), null)
  })

  // Order creation must never be blocked by a geocoder outage.
  test('a thrown fetch is swallowed', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof globalThis.fetch
    assert.equal(await reverseGeocode(16.84, 96.17), null)
  })
})

// ---------------------------------------------------------------------------

describe('reverseGeocode — Nominatim', () => {
  test('keeps the documented query shape', async () => {
    setEnv({})
    stubFetch({ display_name: 'No. 12, Thitsar Road, Yangon' })
    const r = await reverseGeocode(16.8409, 96.1735)

    const url = new URL(calls[0]!)
    assert.equal(url.pathname, '/reverse')
    assert.equal(url.searchParams.get('format'), 'jsonv2')
    assert.equal(url.searchParams.get('lat'), '16.8409')
    assert.equal(url.searchParams.get('lon'), '96.1735')
    assert.equal(r?.label, 'No. 12, Thitsar Road, Yangon')
  })

  /**
   * `new URL('/reverse', base)` drops the base's own path, which breaks every
   * self-hosted instance served under a sub-path.
   */
  test('preserves a sub-path on a self-hosted base URL', async () => {
    setEnv({
      NEXT_PUBLIC_GEOCODER_PROVIDER: 'self_hosted',
      NEXT_PUBLIC_GEOCODER_BASE_URL: 'https://geo.mingalar.example/nominatim',
    })
    stubFetch({ display_name: 'Somewhere' })
    await reverseGeocode(16.84, 96.17)
    assert.match(calls[0]!, /^https:\/\/geo\.mingalar\.example\/nominatim\/reverse\?/)
  })

  test('tolerates a trailing slash on the base URL', async () => {
    setEnv({
      NEXT_PUBLIC_GEOCODER_PROVIDER: 'self_hosted',
      NEXT_PUBLIC_GEOCODER_BASE_URL: 'https://geo.mingalar.example/nominatim/',
    })
    stubFetch({ display_name: 'Somewhere' })
    await reverseGeocode(16.84, 96.17)
    assert.match(calls[0]!, /\/nominatim\/reverse\?/)
    assert.doesNotMatch(calls[0]!, /\/\/reverse/)
  })

  test('an empty display_name is a miss', async () => {
    setEnv({})
    stubFetch({ display_name: '' })
    assert.equal(await reverseGeocode(16.84, 96.17), null)
  })
})

// ---------------------------------------------------------------------------

describe('forwardGeocode — MapTiler', () => {
  const FEATURES = {
    features: [
      {
        id: 'address.1',
        text: 'Thitsar Road',
        place_name: 'Thitsar Road, Thingangyun, Yangon',
        center: [96.1735, 16.8409],
      },
    ],
  }

  beforeEach(() => {
    setEnv({ NEXT_PUBLIC_GEOCODER_PROVIDER: 'maptiler', NEXT_PUBLIC_MAP_API_KEY: 'MAPKEY' })
  })

  test('puts the query in the path and restricts to Myanmar', async () => {
    stubFetch(FEATURES)
    await forwardGeocode('Thitsar')
    const url = new URL(calls[0]!)
    assert.match(url.pathname, /\/geocoding\/Thitsar\.json$/)
    assert.equal(url.searchParams.get('country'), 'mm')
    assert.equal(url.searchParams.get('key'), 'MAPKEY')
  })

  test('sends the Greater Yangon search bbox as minLng,minLat,maxLng,maxLat', async () => {
    stubFetch(FEATURES)
    await forwardGeocode('Thitsar')
    assert.equal(new URL(calls[0]!).searchParams.get('bbox'), '96.02,16.72,96.37,17.05')
  })

  test('biases ordering toward Thingangyun Base', async () => {
    stubFetch(FEATURES)
    await forwardGeocode('Thitsar')
    assert.equal(new URL(calls[0]!).searchParams.get('proximity'), '96.1693,16.8478')
  })

  /**
   * The query is a path segment. An unescaped '/' would silently change the
   * request path rather than search for the text the shop typed.
   */
  test('encodes a query containing a slash', async () => {
    stubFetch(FEATURES)
    await forwardGeocode('No. 12/A Thitsar')
    assert.match(calls[0]!, /No\.%2012%2FA%20Thitsar\.json/)
    assert.doesNotMatch(new URL(calls[0]!).pathname, /12\/A/)
  })

  // center is [lng, lat] — swapped relative to every LatLng in this codebase.
  test('reads center as [lng, lat], not [lat, lng]', async () => {
    stubFetch(FEATURES)
    const [first] = await forwardGeocode('Thitsar')
    assert.equal(first?.point.lat, 16.8409)
    assert.equal(first?.point.lng, 96.1735)
  })

  test('splits the label into a name and the remaining detail', async () => {
    stubFetch(FEATURES)
    const [first] = await forwardGeocode('Thitsar')
    assert.equal(first?.name, 'Thitsar Road')
    assert.equal(first?.detail, 'Thingangyun, Yangon')
    assert.equal(first?.label, 'Thitsar Road, Thingangyun, Yangon')
  })

  /**
   * The search bbox is padded wider than the hard geofence, so a result the
   * database would refuse CAN come back. It must be returned and flagged, not
   * dropped — an empty dropdown is far less useful than "found, but out of
   * area".
   */
  test('flags a candidate outside the hard geofence rather than dropping it', async () => {
    stubFetch({
      features: [
        { id: 'a', text: 'In', place_name: 'In area', center: [96.1735, 16.8409] },
        // Inside the padded search box, outside in_service_area().
        { id: 'b', text: 'Out', place_name: 'Out of area', center: [96.03, 16.73] },
      ],
    })
    const results = await forwardGeocode('anything')
    assert.equal(results.length, 2)
    assert.equal(results[0]?.inServiceArea, true)
    assert.equal(results[1]?.inServiceArea, false)
  })

  test('dedupes repeated labels', async () => {
    stubFetch({
      features: [
        { id: 'a', text: 'Thitsar Road', place_name: 'Thitsar Road, Yangon', center: [96.17, 16.84] },
        { id: 'b', text: 'Thitsar Road', place_name: 'Thitsar Road, Yangon', center: [96.17, 16.84] },
      ],
    })
    assert.equal((await forwardGeocode('Thitsar')).length, 1)
  })

  test('skips features with no usable centre', async () => {
    stubFetch({ features: [{ id: 'a', place_name: 'No centre' }] })
    assert.deepEqual(await forwardGeocode('x y z'), [])
  })

  test('a short query never reaches the network', async () => {
    stubFetch(FEATURES)
    assert.deepEqual(await forwardGeocode('Th'), [])
    assert.deepEqual(await forwardGeocode('   '), [])
    assert.equal(calls.length, 0)
  })

  test('a non-200 response yields no candidates', async () => {
    stubFetch(FEATURES, false)
    assert.deepEqual(await forwardGeocode('Thitsar'), [])
  })

  // Search is a convenience over the map pin, never a prerequisite.
  test('a thrown fetch is swallowed', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline')
    }) as typeof globalThis.fetch
    assert.deepEqual(await forwardGeocode('Thitsar'), [])
  })
})

describe('forwardGeocode — Nominatim', () => {
  beforeEach(() => setEnv({}))

  test('uses /search with countrycodes and a bounded viewbox', async () => {
    stubFetch([])
    await forwardGeocode('Thitsar')
    const url = new URL(calls[0]!)
    assert.equal(url.pathname, '/search')
    assert.equal(url.searchParams.get('q'), 'Thitsar')
    assert.equal(url.searchParams.get('countrycodes'), 'mm')
    assert.equal(url.searchParams.get('bounded'), '1')
  })

  /**
   * Nominatim's viewbox is left,top,right,bottom — minLng,maxLat,maxLng,minLat.
   * Feeding it MapTiler's [minLng,minLat,maxLng,maxLat] gives an inverted box
   * and zero results, with no error.
   */
  test('converts the bbox to Nominatim viewbox ordering', async () => {
    stubFetch([])
    await forwardGeocode('Thitsar')
    assert.equal(new URL(calls[0]!).searchParams.get('viewbox'), '96.02,17.05,96.37,16.72')
  })

  test('parses lat/lon strings into a LatLng', async () => {
    stubFetch([
      { place_id: 42, display_name: 'Thitsar Road, Yangon', name: 'Thitsar Road', lat: '16.8409', lon: '96.1735' },
    ])
    const [first] = await forwardGeocode('Thitsar')
    assert.deepEqual(first?.point, { lat: 16.8409, lng: 96.1735 })
    assert.equal(first?.id, '42')
    assert.equal(first?.inServiceArea, true)
  })

  test('a MapTiler-shaped body yields nothing rather than garbage', async () => {
    stubFetch({ features: [{ place_name: 'x', center: [96.17, 16.84] }] })
    assert.deepEqual(await forwardGeocode('Thitsar'), [])
  })
})
