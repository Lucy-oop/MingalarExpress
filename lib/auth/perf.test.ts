import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

/**
 * The two things that made navigation fast, and that nothing else would catch.
 *
 * MEASURED BEFORE AND AFTER, against this project's own Supabase:
 *
 *     /admin         1.70-2.16s  ->  0.54-0.61s
 *     /admin/kpay    0.40-1.89s  ->  0.37-0.42s
 *     /admin/orders  0.54-1.38s  ->  0.45-0.50s
 *
 * `auth.getUser()` is not a cookie read — @supabase/ssr calls GoTrue to verify
 * the JWT, 190-870ms against this project — and it was being called three
 * times per page render, with three or four `profiles` reads beside it,
 * because the layout guard and the page guard and (under /admin/super) a third
 * nested guard each did their own. Ten sequential round trips on
 * /shop/dashboard.
 *
 * Neither fix is visible in a type, and neither breaks a test if removed: the
 * app stays correct and simply goes back to being slow. Slow does not fail a
 * build, so it needs a guard.
 */
const guards = readFileSync(new URL('./guards.ts', import.meta.url), 'utf8')
const ROOT = new URL('../../', import.meta.url)

describe('the auth lookup is fetched once per request', () => {
  test('guards.ts imports React cache', () => {
    assert.match(
      guards,
      /import \{ cache \} from 'react'/,
      'the React.cache import is gone — every guard is round-tripping again',
    )
  })

  test('and the loader is wrapped in it', () => {
    assert.match(
      guards,
      /const loadAuth = cache\(/,
      'loadAuth is no longer memoised; layout + page guards will each pay a getUser',
    )
  })

  /**
   * The whole point is that ONE function talks to the auth server. If a second
   * `getUser()` call appears in this file, some path has gone around the memo.
   */
  /*
    COUNTED ON CODE, NOT ON THE FILE. The first version of this counted every
    occurrence and found two — because guards.ts's own docblock explains what
    `auth.getUser()` costs, and the scan read its own documentation. That is
    precisely the failure shop-nav.test.ts records ("a source-scanning test has
    to look at code"), walked into again while writing a test about it.
  */
  const code = guards.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  test('exactly one call site talks to the auth server', () => {
    const calls = code.match(/auth\.getUser\(\)/g) ?? []
    assert.equal(
      calls.length,
      1,
      `${calls.length} getUser() calls in guards.ts — every one past the first is a ` +
        'round trip per render that loadAuth exists to remove',
    )
  })

  /**
   * `redirect()` throws. Caching a function that throws works, but it turns the
   * memo into a control-flow device — so the policy stays in requireUser and
   * the cache stays a plain value.
   */
  test('the memo returns data and does not redirect', () => {
    const body = guards.slice(guards.indexOf('const loadAuth = cache('), guards.indexOf('/** Authenticated session'))
    assert.ok(!body.includes('redirect('), 'loadAuth redirects — the memo is caching a throw')
  })
})

describe('every shell can paint before its data arrives', () => {
  /*
    These three are what turn a two-second freeze into an immediate response,
    and they do something a comment cannot: every protected route is
    `force-dynamic`, and Next will not prefetch a dynamic route's CONTENT — but
    it will prefetch its loading boundary. Without these files, <Link> prefetch
    had nothing to fetch for any route in the app and every click started cold.

    Verified by hand at the time: a prefetch of /admin returns 11.7KB
    containing the skeleton and none of the board.
  */
  for (const shell of ['admin', 'rider', 'shop']) {
    test(`app/${shell}/loading.tsx exists`, () => {
      assert.ok(
        existsSync(new URL(`app/${shell}/loading.tsx`, ROOT)),
        `app/${shell}/loading.tsx is gone — that shell freezes on navigation again, ` +
          'and its routes stop being prefetchable',
      )
    })
  }
})

describe('signing out says something while it works', () => {
  const button = readFileSync(new URL('components/auth/sign-out-button.tsx', ROOT), 'utf8')

  test('it reads the form status', () => {
    assert.match(button, /useFormStatus/, 'the pending state is gone from sign out')
  })

  /**
   * A sign-out is a round trip plus `revalidatePath('/', 'layout')` plus a
   * redirect — over a second of nothing. An enabled button through all of it
   * invites a second press, which posts the action again against a session the
   * first one already destroyed.
   */
  test('and disables the button while pending', () => {
    assert.match(button, /disabled=\{pending\}/, 'sign out can be double-submitted again')
  })

  test('no shell rolls its own sign-out form', () => {
    for (const f of [
      'app/admin/layout.tsx',
      'app/shop/layout.tsx',
      'app/rider/layout.tsx',
      'components/legal/policy-gate.tsx',
    ]) {
      const src = readFileSync(new URL(f, ROOT), 'utf8')
      assert.ok(
        !src.includes('action={signOut}'),
        `${f} has its own signOut form again — it will have no pending state`,
      )
    }
  })
})
