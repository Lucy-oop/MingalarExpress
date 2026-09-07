import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Source-level guards on the bell shell, in the same spirit as
 * `components/shop/shop-nav.test.ts`: these are invariants a type cannot hold
 * and this repo has no DOM test harness, so the check is on the source.
 */
const shell = readFileSync('components/shared/notice-bell.tsx', 'utf8')
const admin = readFileSync('components/admin/notice-bell.tsx', 'utf8')
const shop = readFileSync('components/shop/shop-notice-bell.tsx', 'utf8')

describe('the notice bell shell', () => {
  /**
   * THE COUNT MUST FREEZE WHEN THE PANEL OPENS. Marking seen triggers a
   * refresh, and without the freeze the badge empties while the reader is
   * halfway down the list — so the list stops matching the number that made
   * them open it.
   */
  test('the unseen count is frozen on open, not read live', () => {
    assert.match(shell, /dismissed/, 'the freeze is gone — the badge will empty mid-read')
    assert.match(
      shell,
      /const showing = dismissed \? 0 : unseen/,
      'the badge no longer renders the frozen count',
    )
  })

  /**
   * The bell is mounted in a LAYOUT, so a Link inside it navigates without
   * unmounting anything. Without a way to close, the panel stays open on top of
   * the page it just sent the reader to.
   */
  test('rows can close the drawer', () => {
    assert.match(shell, /children: \(close: \(\) => void\) => React\.ReactNode/)
    assert.match(shell, /children\(\(\) => setOpen\(false\)\)/)
  })

  /** A bare bell icon tells a screen reader nothing. */
  test('the trigger carries an aria-label', () => {
    assert.match(shell, /aria-label=\{ariaLabel\}/)
  })

  /**
   * Reuse, not a second dialog. `components/ui/overlay` already has Escape, the
   * backdrop, the scroll lock and focus restore, and was hand-rolled to keep a
   * headless-UI dependency off cheap Android phones.
   */
  test('it uses the shared Overlay rather than its own popover', () => {
    assert.match(shell, /from '@\/components\/ui\/overlay'/)
  })
})

describe('both shells use it', () => {
  test('the office bell and the shop bell share the frame', () => {
    for (const [name, src] of [
      ['admin', admin],
      ['shop', shop],
    ] as const) {
      assert.match(
        src,
        /from '@\/components\/shared\/notice-bell'/,
        `${name} bell no longer shares the shell — the two will drift`,
      )
      assert.match(src, /onOpen=\{markNoticesSeen\}/, `${name} bell does not mark seen`)
    }
  })

  /**
   * The shop's rows are colour- and icon-coded per kind and must keep coming
   * from the shared row component, so the drawer cannot drift from the page.
   */
  test('the shop bell reuses the page’s row', () => {
    assert.match(shop, /from '@\/components\/orders\/notification-row'/)
    assert.match(shop, /compact/, 'the drawer should ask for the compact row')
  })

  /** The 120-event page is still where the full history lives. */
  test('the shop drawer links on to the full page', () => {
    assert.match(shop, /href="\/shop\/notifications"/)
  })
})
