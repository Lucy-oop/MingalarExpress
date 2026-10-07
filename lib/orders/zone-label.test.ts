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

/**
 * 0058: no shop-facing screen and no printed waybill shows an internal way.
 * The way is the office's run planning, chosen on the Ways board.
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('shops never see a way name', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const files: string[] = [join(root, 'components/orders/parcel-label.tsx')]
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (full.endsWith('.tsx')) files.push(full)
    }
  }
  walk(join(root, 'app/shop'))

  test('no shop page or waybill renders a route/way name', () => {
    const offenders = files.filter((f) =>
      /\broutes\.name\b|\broute\.name\b|\brouteName\b/.test(
        readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
      ),
    )
    assert.deepEqual(offenders, [])
  })

  test('the "not unlocked yet" labels say ကြိုရှင်း, not COD', async () => {
    const { DICTIONARY } = await import('@/lib/i18n/dictionary')
    for (const key of ['sd.awaiting', 'ss.awaiting'] as const) {
      assert.equal(DICTIONARY[key].my, 'ကြိုရှင်း ကို မဖွင့်ရသေးပါ')
    }
  })
})
