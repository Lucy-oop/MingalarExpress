import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { matchAreaFromAddress, type AreaLike } from './area-match'

/** The real service areas, names as seeded. */
const AREAS: AreaLike[] = [
  { areaId: 'yadanar', areaName: 'Yadanar', areaNameMm: 'ရတနာ' },
  { areaId: 'lhay', areaName: 'Lhay Htaung Kan', areaNameMm: 'လှည်းတောင်ကန်' },
  { areaId: 'bahan', areaName: 'Bahan', areaNameMm: 'ဗဟန်း' },
  { areaId: 'kamayut', areaName: 'Kamayut', areaNameMm: 'ကမာရွတ်' },
  { areaId: 'kyauktada', areaName: 'Kyauktada / Sule', areaNameMm: 'ကျောက်တံတား' },
  { areaId: 'tamwe', areaName: 'Tamwe', areaNameMm: 'တာမွေ' },
  { areaId: 'sdagon', areaName: 'South Dagon', areaNameMm: 'တောင်ဒဂုံ' },
  { areaId: 'yankin', areaName: 'Yankin', areaNameMm: 'ရန်ကင်း' },
  { areaId: 'mtnyunt', areaName: 'Mingalar Taungnyunt', areaNameMm: 'မင်္ဂလာတောင်ညွန့်' },
  { areaId: 'saung', areaName: 'Saung Thuma', areaNameMm: 'ဆောင်သုမ' },
]

/**
 * THE NINE REAL ORDERS from staging, verbatim. Three of them were filed under
 * the wrong area and rode the wrong run; this is the data the rule was derived
 * from, so it is the data it has to keep getting right.
 */
const LIVE: Array<{ addr: string; chose: string; expect: string | null; bad: boolean }> = [
  { addr: 'Bldg C, Room 402, Yadanar Housing, Thingangyun', chose: 'yadanar', expect: 'yadanar', bad: false },
  { addr: 'No. 7, Baho Street, Lhay Htaung Kan Ward, Thingangyun', chose: 'lhay', expect: 'lhay', bad: false },
  { addr: 'Ah Zit Kone Ward (Sa Yar San Ward), Bahan, Kamayut District, Yangon City, Yangon, 11201, Myanmar', chose: 'bahan', expect: 'bahan', bad: false },
  { addr: 'Kan Bawza Street, Shwe Taung Kyar No (2) Ward, Bahan, Kamayut District, Yangon City, Yangon, 11201, Myanmar', chose: 'kyauktada', expect: 'bahan', bad: true },
  { addr: 'Pyidaungsu Main Road, No (26) Ward, South Dagon, Dagon Myothit District, Yangon City, Yangon, 11431, Myanmar', chose: 'tamwe', expect: 'sdagon', bad: true },
  { addr: 'Sule Pagoda Road, Kyauktada', chose: 'kyauktada', expect: 'kyauktada', bad: false },
  { addr: 'Sae Myaung Road, No (11) Ward, Yankin, Thingangyun District, Yangon City, Yangon, 11081, Myanmar', chose: 'mtnyunt', expect: 'yankin', bad: true },
  { addr: 'Sule Pagoda Road, Kyauktada', chose: 'kyauktada', expect: 'kyauktada', bad: false },
  { addr: 'Sule Pagoda Road, Kyauktada', chose: 'kyauktada', expect: 'kyauktada', bad: false },
]

describe('matchAreaFromAddress — against the nine real orders', () => {
  for (const [i, row] of LIVE.entries()) {
    test(`#${i + 1} ${row.bad ? 'catches' : 'clears'} "${row.addr.slice(0, 44)}…"`, () => {
      const m = matchAreaFromAddress(row.addr, AREAS, row.chose)
      assert.equal(m.suggestedId, row.expect)
      assert.equal(m.contradicts, row.bad)
    })
  }

  test('all three mis-filed parcels are caught and none of the six good ones', () => {
    const flagged = LIVE.filter((r) => matchAreaFromAddress(r.addr, AREAS, r.chose).contradicts)
    assert.equal(flagged.length, 3)
    assert.deepEqual(
      flagged.map((r) => r.chose),
      ['kyauktada', 'tamwe', 'mtnyunt'],
    )
  })

  /**
   * The case that killed the nearest-centroid approach. This parcel is
   * genuinely in Bahan and the shop picked Bahan, but Bahan's centroid is 2.2 km
   * away while a Thingangyun ward's placeholder sits 1.1 km away — so centroids
   * would have "corrected" a correct choice onto a cheaper route.
   */
  test('the Bahan parcel that nearest-centroid got wrong is left alone', () => {
    const row = LIVE[2]!
    const m = matchAreaFromAddress(row.addr, AREAS, 'bahan')
    assert.equal(m.contradicts, false)
    assert.equal(m.suggestedId, 'bahan')
  })
})

describe('matchAreaFromAddress — the ordering rule', () => {
  /**
   * A reverse-geocoded address runs specific to general, so the township always
   * precedes the district containing it. Getting this backwards would file every
   * western parcel under Kamayut.
   */
  test('the township beats the district that contains it', () => {
    const m = matchAreaFromAddress('Kan Bawza Street, Bahan, Kamayut District, Yangon', AREAS)
    assert.equal(m.suggestedId, 'bahan')
    assert.deepEqual(m.namedIds, ['bahan', 'kamayut'])
  })

  test('every mention is reported, earliest first', () => {
    const m = matchAreaFromAddress('near Yankin market, Bahan', AREAS)
    assert.deepEqual(m.namedIds, ['yankin', 'bahan'])
  })

  /** An address naming a neighbour must not flag a shop who picked either one. */
  test('a choice among the named areas never contradicts', () => {
    for (const chosen of ['yankin', 'bahan']) {
      assert.equal(matchAreaFromAddress('near Yankin market, Bahan', AREAS, chosen).contradicts, false)
    }
    assert.equal(matchAreaFromAddress('near Yankin market, Bahan', AREAS, 'tamwe').contradicts, true)
  })
})

describe('matchAreaFromAddress — compound and Burmese names', () => {
  test('either half of a compound name matches', () => {
    assert.equal(matchAreaFromAddress('Sule Pagoda Road', AREAS).suggestedId, 'kyauktada')
    assert.equal(matchAreaFromAddress('36th Street, Kyauktada', AREAS).suggestedId, 'kyauktada')
  })

  test('a Burmese address matches the Burmese name', () => {
    const m = matchAreaFromAddress('အမှတ် ၇၊ ဗဟန်း', AREAS)
    assert.equal(m.suggestedId, 'bahan')
  })

  test('case and padding do not matter', () => {
    assert.equal(matchAreaFromAddress('  BAHAN  ', AREAS).suggestedId, 'bahan')
  })
})

describe('matchAreaFromAddress — saying nothing rather than guessing', () => {
  test('an address naming no area suggests nothing and contradicts nothing', () => {
    const m = matchAreaFromAddress('No. 12, second lane behind the pagoda', AREAS, 'tamwe')
    assert.equal(m.suggestedId, null)
    assert.deepEqual(m.namedIds, [])
    // Silence is not disagreement — a hand-typed address must not nag.
    assert.equal(m.contradicts, false)
  })

  test('an empty address is silent', () => {
    assert.deepEqual(matchAreaFromAddress('', AREAS, 'tamwe'), {
      suggestedId: null,
      namedIds: [],
      contradicts: false,
    })
    assert.equal(matchAreaFromAddress('   ', AREAS).suggestedId, null)
  })

  test('no areas configured is silent rather than a crash', () => {
    assert.equal(matchAreaFromAddress('Bahan', []).suggestedId, null)
  })

  test('with nothing chosen yet there is a suggestion but no contradiction', () => {
    const m = matchAreaFromAddress('Kan Bawza Street, Bahan', AREAS, null)
    assert.equal(m.suggestedId, 'bahan')
    assert.equal(m.contradicts, false)
  })
})
