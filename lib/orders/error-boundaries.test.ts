import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

/**
 * Error and loading boundaries. Neither shows up in a type, neither fails a
 * build if deleted, and the app keeps working — it just goes back to showing
 * Next's bare "Application error: a client-side exception has occurred" with
 * no branding, no way back and no phone number, which for a rider is a blank
 * screen in the street.
 */
const read = (p: string) => readFileSync(p, 'utf8')
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('every shell can fail without going blank', () => {
  for (const shell of ['admin', 'rider', 'shop']) {
    test(`app/${shell}/error.tsx exists and is a client component`, () => {
      const p = `app/${shell}/error.tsx`
      assert.ok(existsSync(p), `${p} is gone — that shell falls back to Next's default screen`)
      assert.match(read(p), /^'use client'/, `${p} must be a Client Component`)
    })
  }

  /**
   * `retry` re-fetches and re-renders the segment; `reset` only clears the
   * boundary and re-renders the same children, which for a server-render
   * failure fails again immediately. Next's docs say to prefer retry, and the
   * prop is named `retry` in this version — a boundary written against `reset`
   * from an older tutorial gets `undefined` and throws on click.
   */
  test('they take Next\'s retry prop, not reset', () => {
    for (const shell of ['admin', 'rider', 'shop']) {
      const src = strip(read(`app/${shell}/error.tsx`))
      assert.match(src, /retry,/, `${shell} does not accept retry`)
      assert.ok(!/\breset\b/.test(src), `${shell} is written against reset — it will be undefined`)
    }
    const panel = strip(read('components/shared/error-panel.tsx'))
    assert.match(panel, /retry\(\)/, 'the panel never calls retry')
  })

  /**
   * app/admin/layout.tsx mounts no I18nProvider — the office panel is
   * English-only whatever the locale cookie says. `useT()` there would throw
   * INSIDE an error boundary, which is the worst place in the app to throw.
   */
  test('the admin boundary does not reach for a provider it has not got', () => {
    /*
      ON STRIPPED SOURCE. The docblock in admin/error.tsx explains why useT()
      must NOT be called there, so scanning the raw file finds the prose and
      fails on the very file it is describing. Fifth time this repo has hit
      that; shop-nav.test.ts records the first.
    */
    assert.ok(
      !/useT/.test(strip(read('app/admin/error.tsx'))),
      'admin/error.tsx calls useT(), but the admin shell mounts no I18nProvider',
    )
    for (const shell of ['rider', 'shop']) {
      assert.match(strip(read(`app/${shell}/error.tsx`)), /useT\(\)/, `${shell} lost its translations`)
    }
  })

  /** Everyone who sees this screen is holding parcels or cash. */
  test('the panel offers a way out and a way to reach a human', () => {
    const panel = read('components/shared/error-panel.tsx')
    assert.match(panel, /ContactSupport/, 'the error screen no longer offers the office')
    assert.match(panel, /size="touch"/, 'the retry button is below the 56px primary-action size')
    assert.match(panel, /error\.digest/, 'the reference is gone — the office cannot find it in the logs')
  })
})

describe('the root boundary depends on nothing', () => {
  const g = 'app/global-error.tsx'

  test('it exists', () => {
    assert.ok(existsSync(g), 'a failure in a shell LAYOUT now hits Next\'s default page')
  })

  /**
   * Next replaces the root layout with this file and does NOT load global
   * styles into it. Tailwind classes silently do nothing here, and every
   * component in the design system is styled with them — so importing one
   * renders it unstyled. The duplication is deliberate.
   */
  test('it renders its own document and imports no styled component', () => {
    const src = read(g)
    assert.match(src, /<html/, 'global-error must render its own <html>')
    assert.match(src, /<body/, 'global-error must render its own <body>')
    const imports = strip(src).match(/^import .*$/gm) ?? []
    assert.deepEqual(
      imports,
      [],
      `global-error imports ${imports.join(', ')} — globals.css is not loaded here, so anything Tailwind-styled renders naked`,
    )
  })

  test('and says it in both languages, since no provider reaches it', () => {
    const src = read(g)
    assert.match(src, /lang="my"/, 'the Burmese half is gone and there is no provider to add it back')
    assert.match(src, /retry\(\)/, 'the root boundary has no way to recover')
  })
})

describe('loading states match the page underneath', () => {
  /**
   * A shell's loading.tsx applies to every route beneath it, so a route whose
   * layout differs from the shell's main page flashes the wrong shape and then
   * rearranges itself as the real content lands. These three differ most.
   */
  for (const route of [
    'app/track/[code]/loading.tsx',
    'app/shop/settings/loading.tsx',
    'app/admin/audit/loading.tsx',
    'app/admin/super/pricing/loading.tsx',
  ]) {
    test(`${route} exists`, () => {
      assert.ok(existsSync(route), `${route} is gone — it will flash its shell's skeleton instead`)
    })
  }

  /** The public one is the only skeleton a stranger ever sees. */
  test('the tracking skeleton draws the timeline, not a generic block', () => {
    const src = read('app/track/[code]/loading.tsx')
    assert.match(src, /size-6 shrink-0 rounded-full/, 'the timeline nodes are gone')
    assert.match(src, /BrandMark/, 'the wordmark is gone — it is free and it is the point')
  })

  /**
   * `animate-pulse` and nothing else. A shimmer sweep costs a compositing layer
   * per frame, on the cheapest phones and the worst connections in the product.
   */
  test('no skeleton reaches for a shimmer', () => {
    for (const f of [
      'components/ui/skeleton.tsx',
      'app/track/[code]/loading.tsx',
      'app/shop/settings/loading.tsx',
      'app/admin/audit/loading.tsx',
      'app/admin/super/pricing/loading.tsx',
    ]) {
      assert.ok(
        !/animate-\[shimmer|bg-gradient-to-r/.test(strip(read(f))),
        `${f} added a gradient sweep`,
      )
    }
  })
})
