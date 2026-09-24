import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

/**
 * A migration's triggers and policies must survive being run twice.
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * This project is migrated by two tools with two histories. scripts/db-push.sh
 * records what ran in `public.schema_migrations`; the Supabase CLI records it
 * in `supabase_migrations.schema_migrations`. When the CLI's history is behind,
 * `npx supabase db push` re-applies files the database already has -- and a
 * bare `create trigger` then fails with 42710 "already exists" and blocks every
 * migration after it. That is exactly how 0908100000_delivery_zones stopped a
 * push: `delivery_zones_touch` was already there.
 *
 * `create trigger` and `create policy` have no IF NOT EXISTS, so the guard is a
 * `drop ... if exists` for the same name on the same table, earlier in the same
 * file. Constraints and indexes get the same treatment from 0908100000 on,
 * which is where the CLI's history stopped.
 *
 * A source scan, like enum-safety.test.ts, because `npm run db:verify` applies
 * every file exactly once to an empty database and so cannot see this at all.
 */
const DIR = new URL('.', import.meta.url)
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

/** Where the CLI's history stopped; every file from here on may be re-run. */
const RERUN_FROM = '20260908100000'

/** SQL without comments or $$ bodies, so prose and function code are not read as DDL. */
function code(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '$$$$')
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('triggers and policies are guarded for a re-run', () => {
  test('there are migrations to check', () => {
    assert.ok(files.length > 20, `only ${files.length} migration(s) found — wrong directory?`)
  })

  for (const file of files) {
    const bare = code(readFileSync(new URL(file, DIR), 'utf8'))

    for (const kind of ['trigger', 'policy'] as const) {
      const creates = [
        ...bare.matchAll(new RegExp(`\\bcreate\\s+${kind}\\s+("?\\w+"?)\\s+[\\s\\S]*?\\bon\\s+([\\w."]+)`, 'gi')),
      ]
      for (const m of creates) {
        const [, name, table] = m
        test(`${file}: ${kind} ${name} on ${table}`, () => {
          const before = bare.slice(0, m.index)
          assert.match(
            before,
            new RegExp(`\\bdrop\\s+${kind}\\s+if\\s+exists\\s+${esc(name!)}\\s+on\\s+${esc(table!)}\\b`, 'i'),
            `add \`drop ${kind} if exists ${name} on ${table};\` before it`,
          )
        })
      }
    }
  }
})

describe('constraints and indexes are guarded where the CLI re-runs', () => {
  for (const file of files.filter((f) => f >= RERUN_FROM)) {
    const bare = code(readFileSync(new URL(file, DIR), 'utf8'))

    for (const m of bare.matchAll(/\badd\s+constraint\s+(\w+)/gi)) {
      const name = m[1]!
      test(`${file}: constraint ${name}`, () => {
        assert.match(
          bare.slice(0, m.index),
          new RegExp(`drop\\s+constraint\\s+if\\s+exists\\s+${esc(name)}\\b`, 'i'),
          `add \`drop constraint if exists ${name}\` before it`,
        )
      })
    }

    test(`${file}: every index says IF NOT EXISTS`, () => {
      const bad = [...bare.matchAll(/\bcreate\s+(?:unique\s+)?index\s+(?!if\s+not\s+exists)(\w+)/gi)]
      assert.deepEqual(bad.map((m) => m[1]), [], 'use `create index if not exists`')
    })
  }
})
