import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

/**
 * A migration must not USE an enum value in the same file that ADDS it.
 *
 * ---------------------------------------------------------------------------
 * WHY A TEST AND NOT JUST A COMMENT
 *
 * Postgres refuses it:
 *
 *     ERROR: 55P04: unsafe use of new value "pickup_pay" of enum type
 *                   ledger_kind
 *     HINT:  New enum values must be committed before they can be used.
 *
 * And `npm run db:verify` CANNOT SEE IT. Both tools in this repo apply one
 * file per psql invocation — `scripts/db-push.sh:144` and
 * `supabase/tests/reset_and_verify.sh:21-23` — and `psql -f` is autocommit,
 * so every statement lands in its own transaction and the value is committed
 * before the next line reads it. The suite goes green.
 *
 * The Supabase SQL editor wraps a pasted script in ONE transaction, and that
 * is how this project is actually migrated. So this is a failure mode the
 * whole 274-assertion suite is blind to by construction, discovered only when
 * 0042 was pasted into the dashboard and refused.
 *
 * A source scan is the only thing that can catch it before someone hits it,
 * because reproducing it needs a transaction the harness never opens.
 *
 * THE FIX IS ALWAYS THE SAME: put the `alter type ... add value` in its own
 * file, named to sort earlier. See `20260914090000_pickup_pay_enum.sql`.
 */
const DIR = new URL('.', import.meta.url)
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

/** SQL with comments removed, so prose about a value is not read as a use. */
function code(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')
}

describe('a migration never uses an enum value it just added', () => {
  test('there are migrations to check', () => {
    assert.ok(files.length > 20, `only ${files.length} migration(s) found — wrong directory?`)
  })

  for (const file of files) {
    const sql = readFileSync(new URL(file, DIR), 'utf8')
    const bare = code(sql)

    // `alter type public.ledger_kind add value if not exists 'pickup_pay'`
    const adds = [...bare.matchAll(/alter\s+type\s+\S+\s+add\s+value(?:\s+if\s+not\s+exists)?\s+'([^']+)'/gi)]
    if (adds.length === 0) continue

    test(`${file} adds ${adds.length} enum value(s) and uses none of them`, () => {
      for (const [statement, value] of adds) {
        const after = bare.slice(bare.indexOf(statement) + statement.length)
        /*
          A plpgsql body is not type-checked at CREATE time, so a literal
          inside one is harmless — but distinguishing that from an index
          predicate reliably means parsing SQL. Flagging every later mention is
          the conservative call: a false positive costs one file split, a false
          negative costs a failed production migration.
        */
        assert.ok(
          !after.includes(`'${value}'`),
          `${file} adds enum value '${value}' and then uses it in the same file.\n` +
            `  Postgres raises 55P04 for this inside a transaction, which is how the\n` +
            `  Supabase SQL editor applies migrations. db:verify cannot see it —\n` +
            `  psql -f is autocommit. Move the ALTER TYPE into its own file, named\n` +
            `  to sort earlier, as 20260914090000_pickup_pay_enum.sql does.`,
        )
      }
    })
  }
})
