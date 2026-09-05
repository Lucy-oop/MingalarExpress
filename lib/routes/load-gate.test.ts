import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadPlan,
  summariseManifest,
  LOAD_BLOCKER_MESSAGE,
  type LoadParcel,
  type LoadTarget,
} from './load-gate'

const parcel = (id: string, codAmount = 0, isReturn = false): LoadParcel => ({
  id,
  codAmount,
  isReturn,
})

/** An empty run on Route A: 60 parcels, 2,000,000 Ks. */
const EMPTY: LoadTarget = {
  tripId: 't1',
  status: 'planned',
  loaded: [],
  maxParcels: 60,
  maxCod: 2_000_000,
}

describe('loadPlan — the leg is derived from the selection', () => {
  test('ordinary parcels are a delivery load', () => {
    const p = loadPlan([parcel('a'), parcel('b')], EMPTY)
    assert.equal(p.leg, 'delivery')
    assert.equal(p.blocker, null)
  })

  test('the same parcels can be collected instead, when asked', () => {
    assert.equal(loadPlan([parcel('a')], EMPTY, 'pickup').leg, 'pickup')
  })

  /**
   * load_trip demands leg='return' for a parcel the shop asked back and refuses
   * it for anything else, both as leg_resolution_mismatch. Deriving the leg
   * makes that error unreachable instead of merely explained.
   */
  test('an all-returns selection is a return load, whatever the mode says', () => {
    const p = loadPlan([parcel('a', 0, true), parcel('b', 0, true)], EMPTY, 'pickup')
    assert.equal(p.leg, 'return')
    assert.equal(p.blocker, null)
  })

  test('a MIXED selection is blocked, never silently split', () => {
    const p = loadPlan([parcel('a'), parcel('b', 0, true)], EMPTY)
    assert.equal(p.blocker, 'mixed_legs')
  })
})

describe('loadPlan — blockers, in the order a dispatcher fixes them', () => {
  test('no target outranks everything', () => {
    assert.equal(loadPlan([], null).blocker, 'no_target')
    assert.equal(loadPlan([parcel('a'), parcel('b', 0, true)], null).blocker, 'no_target')
  })

  test('nothing ticked', () => {
    assert.equal(loadPlan([], EMPTY).blocker, 'nothing_selected')
  })

  test('a departed run cannot be loaded', () => {
    const gone = { ...EMPTY, status: 'departed' }
    assert.equal(loadPlan([parcel('a')], gone).blocker, 'target_not_loadable')
    for (const status of ['planned', 'loading']) {
      assert.equal(loadPlan([parcel('a')], { ...EMPTY, status }).blocker, null, status)
    }
  })

  /** Mixed is reported before the ceilings: it has no single leg to measure. */
  test('a mixed selection is named before any cap', () => {
    const tiny = { ...EMPTY, maxParcels: 1, maxCod: 1 }
    assert.equal(loadPlan([parcel('a', 9e9), parcel('b', 0, true)], tiny).blocker, 'mixed_legs')
  })
})

describe('loadPlan — the ceilings mirror load_trip, asymmetry and all', () => {
  const full = (n: number): LoadTarget['loaded'] =>
    Array.from({ length: n }, () => ({ leg: 'delivery' as const, codAmount: 0 }))

  test('the parcel cap counts what the run would carry AFTER the load', () => {
    const t: LoadTarget = { ...EMPTY, maxParcels: 10, loaded: full(8) }
    assert.equal(loadPlan([parcel('a'), parcel('b')], t).blocker, null) // 8 + 2 = 10
    assert.equal(loadPlan([parcel('a'), parcel('b'), parcel('c')], t).blocker, 'over_parcel_cap')
  })

  /**
   * `p_leg = 'delivery' and v_parcels > max`. A pickup load does not touch the
   * parcel cap at all, and pickups already on the run do not count toward it.
   */
  test('the parcel cap ignores pickups, on both sides', () => {
    const t: LoadTarget = {
      ...EMPTY,
      maxParcels: 2,
      loaded: [
        { leg: 'pickup', codAmount: 0 },
        { leg: 'pickup', codAmount: 0 },
        { leg: 'pickup', codAmount: 0 },
      ],
    }
    assert.equal(loadPlan([parcel('a'), parcel('b')], t).blocker, null)
    // Loading five more pickups onto a 2-parcel route is fine.
    const five = [parcel('a'), parcel('b'), parcel('c'), parcel('d'), parcel('e')]
    assert.equal(loadPlan(five, t, 'pickup').blocker, null)
  })

  test('the cash cap spans every leg', () => {
    const t: LoadTarget = { ...EMPTY, maxCod: 50_000 }
    assert.equal(loadPlan([parcel('a', 50_000)], t).blocker, null)
    assert.equal(loadPlan([parcel('a', 50_001)], t).blocker, 'over_cod_cap')
    assert.equal(loadPlan([parcel('a', 50_001)], t, 'pickup').blocker, 'over_cod_cap')
  })

  /**
   * A return's cod_amount is money nobody will collect. Counting it would block
   * deliveries that WOULD have collected real cash — the reason SQL excludes it.
   */
  test('returns are excluded from the cash cap, incoming and already aboard', () => {
    const t: LoadTarget = {
      ...EMPTY,
      maxCod: 10_000,
      loaded: [{ leg: 'return', codAmount: 900_000 }],
    }
    // The 900,000 aboard is invisible to the cap.
    assert.equal(loadPlan([parcel('a', 10_000)], t).blocker, null)
    // And a huge return load is not cash either.
    assert.equal(loadPlan([parcel('r', 900_000, true)], t).blocker, null)
  })
})

describe('loadPlan — headroom is never negative', () => {
  /** The card used to render "room for -3 more". */
  test('an over-full run reports zero, not a negative', () => {
    const t: LoadTarget = {
      ...EMPTY,
      maxParcels: 2,
      maxCod: 1_000,
      loaded: [
        { leg: 'delivery', codAmount: 5_000 },
        { leg: 'delivery', codAmount: 5_000 },
        { leg: 'delivery', codAmount: 5_000 },
      ],
    }
    const p = loadPlan([], t)
    assert.equal(p.parcelHeadroom, 0)
    assert.equal(p.codHeadroom, 0)
  })

  test('an empty run reports the whole ceiling', () => {
    const p = loadPlan([], EMPTY)
    assert.equal(p.parcelHeadroom, 60)
    assert.equal(p.codHeadroom, 2_000_000)
  })

  test('with no target there is no headroom to report', () => {
    const p = loadPlan([parcel('a')], null)
    assert.equal(p.parcelHeadroom, 0)
    assert.equal(p.codHeadroom, 0)
  })
})

describe('LOAD_BLOCKER_MESSAGE', () => {
  test('every blocker has copy', () => {
    for (const key of [
      'no_target',
      'nothing_selected',
      'mixed_legs',
      'target_not_loadable',
      'over_parcel_cap',
      'over_cod_cap',
    ] as const) {
      assert.ok(LOAD_BLOCKER_MESSAGE[key].trim().length > 0, key)
    }
  })
})

describe('summariseManifest', () => {
  const m = (leg: 'delivery' | 'pickup' | 'return', areaName: string | null, cod = 0) => ({
    leg,
    areaName,
    codAmount: cod,
    paymentMethod: (cod > 0 ? 'cod' : 'prepaid') as 'cod' | 'prepaid',
  })

  test('counts each leg and totals the collectable cash', () => {
    const s = summariseManifest([
      m('delivery', 'Bahan', 10_000),
      m('delivery', 'Bahan', 5_000),
      m('pickup', 'Tamwe'),
      m('return', 'Yankin', 99_000),
    ])
    assert.equal(s.total, 4)
    assert.equal(s.deliveries, 2)
    assert.equal(s.pickups, 1)
    assert.equal(s.returns, 1)
    // The return's 99,000 is not money anyone collects.
    assert.equal(s.cod, 15_000)
  })

  test('areas come back busiest first', () => {
    const s = summariseManifest([
      m('delivery', 'Tamwe'),
      m('delivery', 'Bahan'),
      m('delivery', 'Bahan'),
    ])
    assert.deepEqual(s.areas, [
      { name: 'Bahan', count: 2 },
      { name: 'Tamwe', count: 1 },
    ])
  })

  test('a parcel with no area is named, not dropped', () => {
    const s = summariseManifest([m('delivery', null)])
    assert.deepEqual(s.areas, [{ name: 'No area', count: 1 }])
  })

  test('an empty run summarises to zeroes', () => {
    assert.deepEqual(summariseManifest([]), {
      total: 0,
      deliveries: 0,
      pickups: 0,
      returns: 0,
      cod: 0,
      areas: [],
    })
  })
})
