import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Closing a run is where the rider hands in ALL the cash (0052): riders are
 * paid monthly and never keep cash against their pay. Source scan, like
 * pool-sections.test.ts -- there is no DOM harness here.
 */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const card = strip(readFileSync(new URL('./trip-card.tsx', import.meta.url), 'utf8'))
const dialog = strip(readFileSync(new URL('./close-run-dialog.tsx', import.meta.url), 'utf8'))
const board = strip(readFileSync(new URL('./route-board.tsx', import.meta.url), 'utf8'))

describe('closing a run deposits its cash', () => {
  test('the button says so, and "Close & pay" is gone', () => {
    assert.match(card, /Close run &amp; deposit cash/)
    assert.ok(!/Close &amp; pay/.test(card), '"Close & pay" is back')
  })

  test('the dialog names the full cash, and the zero-cash case', () => {
    assert.match(dialog, /Cash collected from customers/)
    assert.match(dialog, /Confirm that the rider has handed over the full \{formatMmk\(cash\)\} to the office\./)
    assert.match(dialog, /No cash collected\. Confirm closing run\./)
  })

  test('the confirmed amount travels to the server, which re-checks it', () => {
    assert.match(board, /closeRunWithDeposit\(closingTrip\.id, expectedCash\)/)
    assert.ok(!/window\.confirm\(\s*'Close this run/.test(board), 'the bare confirm is back')
  })
})
