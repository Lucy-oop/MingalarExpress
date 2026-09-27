import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

/**
 * 0054 closed two holes found in the cash-flow audit. A source scan, like
 * enum-safety.test.ts, so a LATER migration cannot quietly reopen them --
 * db:verify proves the current state, not that nobody undoes it.
 *
 *   1. is_service_ctx() must never again be "no user signed in" alone: that is
 *      also what an anonymous request looks like, and every money RPC's guard
 *      accepts it.
 *   2. Riders must never again get an UPDATE policy on orders: advance_order
 *      is the only way a rider changes an order, because it enforces the rules
 *      a direct PATCH would skip (cod_amount, collected_via, commission split).
 */
const DIR = new URL('.', import.meta.url)
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
const DOOR = '20260930100000_close_the_anon_door.sql'

const code = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')

describe('the anon door stays closed (0054)', () => {
  test('0054 is present', () => {
    assert.ok(files.includes(DOOR), `${DOOR} is missing`)
  })

  for (const file of files.filter((f) => f > DOOR)) {
    const bare = code(readFileSync(new URL(file, DIR), 'utf8'))

    test(`${file} does not weaken is_service_ctx`, () => {
      const m = /create\s+or\s+replace\s+function\s+public\.is_service_ctx\s*\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/i.exec(bare)
      if (!m) return
      assert.match(m[1]!, /current_setting\(\s*'role'/i, 'is_service_ctx no longer checks the session role')
    })

    test(`${file} gives riders no UPDATE on orders`, () => {
      assert.ok(!/create\s+policy\s+orders_update_rider\b/i.test(bare), 'orders_update_rider is back')
    })

    test(`${file} grants no function to PUBLIC`, () => {
      assert.ok(
        !/grant\s+execute\s+on\s+(all\s+functions|function)[\s\S]*?\bto\s+public\b/i.test(bare),
        'a function was granted to PUBLIC',
      )
    })
  }

  test('0054 itself checks the role and revokes PUBLIC', () => {
    const bare = code(readFileSync(new URL(DOOR, DIR), 'utf8'))
    assert.match(bare, /current_setting\('role', true\)/)
    assert.match(bare, /revoke execute on all functions in schema public from public/)
    assert.match(bare, /drop policy if exists orders_update_rider on public\.orders/)
  })
})
