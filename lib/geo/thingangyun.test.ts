import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { THINGANGYUN_BBOX, THINGANGYUN_SEARCH_BBOX } from './thingangyun'

describe('the service area bounds', () => {
  /**
   * THE INVARIANT. The search box decides what may be FOUND and the save box
   * what may be STORED, and the first must contain the second on every side —
   * otherwise the geocoder cannot return a candidate the database would accept,
   * and an address on the western edge simply has no results.
   */
  test('the search box contains the save box on all four sides', () => {
    assert.ok(THINGANGYUN_SEARCH_BBOX.west <= THINGANGYUN_BBOX.west, 'west')
    assert.ok(THINGANGYUN_SEARCH_BBOX.east >= THINGANGYUN_BBOX.east, 'east')
    assert.ok(THINGANGYUN_SEARCH_BBOX.south <= THINGANGYUN_BBOX.south, 'south')
    assert.ok(THINGANGYUN_SEARCH_BBOX.north >= THINGANGYUN_BBOX.north, 'north')
  })

  /**
   * The townships on the zone rate card, as a regression list. Each was checked
   * against `in_service_area()` on the live schema; this is the TS twin of that
   * gate, and the two must agree or the form accepts what the CHECK refuses.
   */
  const inside = (lat: number, lng: number) =>
    lat >= THINGANGYUN_BBOX.south &&
    lat <= THINGANGYUN_BBOX.north &&
    lng >= THINGANGYUN_BBOX.west &&
    lng <= THINGANGYUN_BBOX.east

  test('every township on the rate card is inside the save box', () => {
    const towns: Array<[string, number, number]> = [
      ['Hlaingtharyar', 16.87, 96.03],
      ['Thanlyin', 16.7565, 96.2578],
      ['Insein', 16.9, 96.1],
      ['Shwepyitha', 16.98, 96.07],
      ['Mingaladon', 16.95, 96.13],
      ['Dagon Seikkan', 16.92, 96.24],
      ['South Dagon', 16.86, 96.22],
      ['Kyauktada', 16.775, 96.16],
      ['Dawbon', 16.78, 96.19],
      ['San Pya (hub)', 16.8478, 96.1693],
    ]
    for (const [name, lat, lng] of towns) {
      assert.ok(inside(lat, lng), `${name} (${lat}, ${lng}) is outside the service area`)
    }
  })

  /** Still a typo guard: somewhere else entirely must stay out. */
  test('Mandalay and a swapped hemisphere are still refused', () => {
    assert.ok(!inside(21.9588, 96.0891), 'Mandalay is inside the Yangon box')
    assert.ok(!inside(96.1693, 16.8478), 'swapped lat/lng passed')
  })
})
