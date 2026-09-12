import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

/**
 * Every function that enumerates rider pay by name must name ALL of it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * `cod_ledger.kind` is an enum and six functions filter on it by listing the
 * kinds they care about. That means adding a pay kind is not one change, it is
 * seven — and the seventh is silent. Nothing fails: the function still runs,
 * still returns a number, and the number is simply short.
 *
 * It has now happened twice.
 *
 *   0008 added `trip_pay` and the dashboard reported zero rider cost on a
 *   route-only day. The fix comment is still in `admin_overview`: "or a
 *   route-only day reports zero rider cost and the dashboard shows a margin
 *   that does not exist."
 *
 *   0042 added `pickup_pay`, updated four readers, and missed two. Its own
 *   header had called this out — "five lists that must agree" — and then got
 *   it wrong anyway. The result was `/admin/super` overstating profit, and
 *   `/admin/audit` showing a breakdown that did not add up to the balance
 *   printed beside it.
 *
 * So the answer is not more care. It is this.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CHECKS
 *
 * The LATEST definition of each function — a migration directory is a stack of
 * redefinitions, and only the last one runs. Checking every definition would
 * fail on 0008's superseded body forever and teach everyone to ignore it.
 *
 * ON STRIPPED SOURCE, for the reason this repo keeps relearning: these bodies
 * discuss the kinds by name in their comments, so a scan of the raw text finds
 * the prose explaining the rule and passes the file that breaks it.
 *
 * TO ADD A KIND: add it to PAY_KINDS, run this, and fix what it names.
 */

/** Ledger kinds that are money owed TO a rider. Extend when one is added. */
const PAY_KINDS = ['commission_earned', 'trip_pay', 'pickup_pay'] as const

const DIR = new URL('.', import.meta.url)
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

/** SQL with comments removed, so prose about a kind is not read as a use. */
function code(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')
}

/** name -> { file, body } for the last definition of each function. */
function latestDefinitions(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>()
  for (const file of files) {
    const sql = code(readFileSync(new URL(file, DIR), 'utf8'))
    const re = /create\s+or\s+replace\s+function\s+public\.(\w+)/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(sql)) !== null) {
      const rest = sql.slice(m.index)
      // A body runs to its dollar-quoted terminator. Falling back to a slice
      // rather than the whole file keeps one unterminated function from
      // swallowing every later definition in the same migration.
      const end = rest.indexOf('$$;')
      out.set(m[1]!, { file, body: end > 0 ? rest.slice(0, end) : rest.slice(0, 6000) })
    }
  }
  return out
}

describe('every pay-kind reader names every pay kind', () => {
  const defs = latestDefinitions()

  test('there are functions to check', () => {
    assert.ok(defs.size > 40, `only ${defs.size} functions parsed — the matcher is wrong`)
  })

  /**
   * ONLY FUNCTIONS THAT AGGREGATE, and that distinction is the test.
   *
   * The bug class is summing a SUBSET of what a rider is owed. A function that
   * merely writes one kind is not exposed to it — `tg_orders_audit` books
   * `commission_earned` and `pickup_pay` per parcel and correctly never
   * mentions `trip_pay`, because whole-run pay is `close_trip`'s job. Anchoring
   * on the mention alone flagged it, which would have taught the next reader to
   * add an exception list instead of trusting the check.
   *
   * `sum(` plus a `commission_earned` filter is what a reader looks like: the
   * oldest pay kind, so anything reasoning about rider pay in aggregate
   * mentions it.
   */
  for (const [name, { file, body }] of [...defs].sort()) {
    if (!body.includes("'commission_earned'")) continue
    if (!body.includes('sum(')) continue

    test(`${name} (${file})`, () => {
      const missing = PAY_KINDS.filter((k) => !body.includes(`'${k}'`))
      assert.deepEqual(
        missing,
        [],
        `public.${name}, last defined in ${file}, filters on 'commission_earned' but ` +
          `never mentions ${missing.map((k) => `'${k}'`).join(', ')}.\n` +
          `  Rider pay is ${PAY_KINDS.join(' + ')}. A reader that lists only some of\n` +
          `  them returns a number that is short, and nothing errors — the dashboard\n` +
          `  just overstates profit, or a settlement underpays. If this function\n` +
          `  genuinely wants a subset, say so with a comment naming the kinds it\n` +
          `  excludes and why; the scan runs on stripped source and will not see it.`,
      )
    })
  }
})
