import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * `npm start` must load the .env files. In Next 16 a bare `next start` does not.
 *
 * WHAT WENT WRONG. `next dev` reads `.env.local` and says so —
 * "- Environments: .env.local". `next start` reads nothing. Almost every
 * variable in this app is `NEXT_PUBLIC_*`, and those are inlined into the
 * bundle by `next build`, so a production-mode server looked completely
 * healthy: pages rendered, sign-in worked, the map had its tiles.
 *
 * Exactly one variable is read from `process.env` at runtime —
 * `SUPABASE_SERVICE_ROLE_KEY` — so exactly one thing broke: creating accounts.
 * Registering a rider failed with "SUPABASE_SERVICE_ROLE_KEY is not configured
 * on the server", pointing at a `.env.local` that was perfectly correct. That
 * is a long way to walk for a one-word cause.
 *
 * `scripts/start.mjs` fixes it with Next's own loader. This guards the wiring,
 * because "simplify the start script back to `next start`" is a completely
 * reasonable-looking change that silently breaks account creation in
 * production mode and nothing else.
 */
const ROOT = new URL('..', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'))
const wrapper = readFileSync(new URL('scripts/start.mjs', ROOT), 'utf8')

describe('npm start loads the environment', () => {
  test('the start script goes through the wrapper, not bare next start', () => {
    const start: string = pkg.scripts?.start ?? ''
    assert.ok(start.includes('scripts/start.mjs'), `start is "${start}"`)
    assert.ok(
      !/(^|\s)next\s+start(\s|$)/.test(start),
      `start calls next start directly, which does not read .env.local: "${start}"`,
    )
  })

  test('the wrapper actually loads env before spawning', () => {
    assert.ok(wrapper.includes('loadEnvConfig'), 'the wrapper does not call loadEnvConfig')
    assert.ok(
      wrapper.indexOf('loadEnvConfig(') < wrapper.indexOf('spawn('),
      'env must be loaded BEFORE the child is spawned — the child inherits process.env',
    )
  })

  /**
   * `dev = false` is what makes the file precedence match production. Passing
   * true would prefer `.env.development*`, which is not what a built server
   * should read and would be invisible until the two files disagreed.
   */
  test('it loads with production precedence', () => {
    assert.match(wrapper, /loadEnvConfig\([^)]*,\s*false\s*\)/)
  })

  /**
   * The whole failure mode was silence. If the wrapper stops reporting what it
   * loaded, the next person debugging this has nothing to go on either.
   */
  test('it says which files it loaded', () => {
    assert.ok(wrapper.includes('- Environments:'), 'the wrapper prints no env summary')
  })
})
