import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * A source-level guard, in the same spirit as the migration-drift check in
 * lib/routes/errors.test.ts. There is no component-test harness in this repo,
 * and the bug this protects against is not visible in any pure function — but it
 * IS visible in one line of source, so that line is what gets pinned.
 *
 * THE BUG. `Overlay`'s focus effect listed `onClose` as a dependency. Every
 * caller passes an inline arrow, which is a new function each render, so the
 * effect tore down and set up again after every keystroke in any dialog field:
 * cleanup restored focus to the trigger, setup moved it to the panel. One
 * character per click, across all twelve dialogs — and the depart override,
 * which requires ten characters, could not be completed at all.
 *
 * The fix routes the handler through a ref. If someone "corrects" the dependency
 * array to satisfy exhaustive-deps, this fails and says why.
 */
const SOURCE = readFileSync(new URL('./overlay.tsx', import.meta.url), 'utf8')

describe('Overlay focus management', () => {
  test('the focus effect depends on `open` alone', () => {
    // The effect is identified by the scroll lock, which only it does.
    const start = SOURCE.indexOf("document.body.style.overflow = 'hidden'")
    assert.ok(start > 0, 'could not find the focus/scroll-lock effect')

    const deps = SOURCE.slice(start).match(/\}, \[([^\]]*)\]\)/)
    assert.ok(deps, 'could not find the effect dependency array')
    assert.equal(
      deps![1]!.trim(),
      'open',
      'the focus effect must depend on `open` only — adding onClose back makes ' +
        'every dialog lose focus after each keystroke, because callers pass an ' +
        'inline arrow. Use onCloseRef.current instead.',
    )
  })

  test('Escape reads the handler from a ref, not from the closure', () => {
    assert.match(SOURCE, /onCloseRef\.current\(\)/)
  })

  test('the panel does not steal focus from a child that already has it', () => {
    // Without this, `autoFocus` on a field inside a dialog never survives.
    assert.match(SOURCE, /contains\(active\)/)
  })
})
