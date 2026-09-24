import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { areaZoneLabel, zoneGroupLabel, zoneShort } from './zone-label'

const DOWNTOWN = {
  areaName: 'Downtown',
  areaNameMm: 'မြို့လယ်',
  zoneCode: 'ZONE_1',
  zoneName: 'Zone 1 — inner Yangon',
  zoneNameMm: 'ဇုန် ၁',
}

describe('zone labels for shops', () => {
  test('"Downtown — Zone 1", the format the shop sees', () => {
    assert.equal(areaZoneLabel(DOWNTOWN, 'en'), 'Downtown — Zone 1')
  })

  test('Burmese uses the Burmese names', () => {
    assert.equal(areaZoneLabel(DOWNTOWN, 'my'), 'မြို့လယ် — ဇုန် ၁')
  })

  test('Burmese without a Burmese zone name still reads in Burmese digits', () => {
    assert.equal(zoneShort({ ...DOWNTOWN, zoneCode: 'ZONE_12', zoneNameMm: null }, 'my'), 'ဇုန် ၁၂')
  })

  test('an unusual zone code falls back to the zone name', () => {
    assert.equal(zoneShort({ ...DOWNTOWN, zoneCode: 'OUTER' }, 'en'), 'Zone 1 — inner Yangon')
  })

  test('group headings are the full zone name', () => {
    assert.equal(zoneGroupLabel(DOWNTOWN, 'en'), 'Zone 1 — inner Yangon')
  })
})

/**
 * The booking form must not show a way. Source scan, like pool-sections: there
 * is no DOM harness, but it can prove nobody puts the way name back.
 */
describe('the shop booking form shows no way names', () => {
  const src = readFileSync(new URL('../../components/orders/order-form.tsx', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  test('no routeName or routeCode is rendered', () => {
    assert.ok(!/\brouteName\b/.test(code), 'order-form renders a way name')
    assert.ok(!/\brouteCode\b/.test(code), 'order-form renders a way code')
  })

  test('the township dropdown is labelled by zone', () => {
    assert.match(code, /areaZoneLabel\(/)
  })
})
