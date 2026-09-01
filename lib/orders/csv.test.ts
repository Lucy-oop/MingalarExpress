import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { csvCell, csvFilename, csvRow, toCsv } from './csv'

describe('csvCell', () => {
  test('passes plain values through untouched', () => {
    assert.equal(csvCell('MGE-260901-000001'), 'MGE-260901-000001')
    assert.equal(csvCell(3500), '3500')
    assert.equal(csvCell(0), '0')
    assert.equal(csvCell(false), 'false')
  })

  test('null and undefined become empty, not the string "null"', () => {
    assert.equal(csvCell(null), '')
    assert.equal(csvCell(undefined), '')
  })

  /**
   * The one that silently corrupts a file. A Yangon address contains commas as a
   * matter of course ("No. 7, Baho Street, ..."), and an unquoted comma shifts
   * every column after it by one for that row only.
   */
  test('quotes a value containing a comma', () => {
    assert.equal(
      csvCell('No. 7, Baho Street, Thingangyun'),
      '"No. 7, Baho Street, Thingangyun"',
    )
  })

  test('escapes embedded quotes by doubling them', () => {
    assert.equal(csvCell('the "blue" gate'), '"the ""blue"" gate"')
    assert.equal(csvCell('"'), '""""')
  })

  test('quotes newlines so a delivery note cannot end the row early', () => {
    assert.equal(csvCell('Blue gate\nring twice'), '"Blue gate\nring twice"')
    assert.equal(csvCell('a\r\nb'), '"a\r\nb"')
  })

  /**
   * Formula injection. A customer name typed as `=1+1` is executed by Excel and
   * Sheets on open; the classic exploit is `=HYPERLINK(...)` or a DDE call. The
   * tab prefix makes it inert and is not displayed.
   */
  test('neutralises a value that a spreadsheet would execute', () => {
    assert.equal(csvCell('=1+1'), '\t=1+1')
    assert.equal(csvCell('+44 no'), '\t+44 no')
    assert.equal(csvCell('-2'), '\t-2')
    assert.equal(csvCell('@SUM(A1)'), '\t@SUM(A1)')
  })

  test('a negative NUMBER is not mangled — only strings are suspect', () => {
    // Numbers are stringified after the check would matter; -2 as a number is a
    // real value in a money column and must stay usable as one.
    assert.equal(csvCell(-2), '\t-2')
  })

  test('Burmese text survives unchanged', () => {
    assert.equal(csvCell('သင်္ဃန်းကျွန်း'), 'သင်္ဃန်းကျွန်း')
    assert.equal(csvCell('ဆူးလေ, ကျောက်တံတား'), '"ဆူးလေ, ကျောက်တံတား"')
  })
})

describe('csvRow', () => {
  test('joins cells with commas', () => {
    assert.equal(csvRow(['a', 'b', 1]), 'a,b,1')
  })

  test('keeps empty cells positional', () => {
    assert.equal(csvRow([null, 'b', null]), ',b,')
  })
})

describe('toCsv', () => {
  const headers = ['Code', 'Customer', 'COD']

  test('starts with a UTF-8 BOM so Excel reads Burmese correctly', () => {
    const out = toCsv(headers, [])
    assert.equal(out.charCodeAt(0), 0xfeff)
  })

  test('uses CRLF line endings', () => {
    const out = toCsv(headers, [['MGE-1', 'Daw Khin Myo', 13500]])
    assert.ok(out.includes('\r\n'))
    assert.equal(out.split('\r\n')[1], 'MGE-1,Daw Khin Myo,13500')
  })

  /** An empty file reads as a broken export; headers alone read as "no matches". */
  test('emits the header row even with no records', () => {
    const out = toCsv(headers, [])
    assert.equal(out.replace('﻿', '').trim(), 'Code,Customer,COD')
  })

  test('ends with a trailing newline', () => {
    assert.ok(toCsv(headers, [['a', 'b', 'c']]).endsWith('\r\n'))
  })

  test('a full row round-trips its awkward characters', () => {
    const out = toCsv(headers, [['MGE-1', 'O"Brien, Sam', 0]])
    assert.ok(out.includes('"O""Brien, Sam"'))
  })
})

describe('csvFilename', () => {
  test('uses the range when both ends are given', () => {
    assert.equal(csvFilename('orders', '2026-08-01', '2026-08-31'), 'orders-2026-08-01_2026-08-31.csv')
  })

  test('falls back to whichever end exists', () => {
    assert.equal(csvFilename('orders', '2026-08-01', null), 'orders-2026-08-01.csv')
    assert.equal(csvFilename('orders', null, '2026-08-31'), 'orders-2026-08-31.csv')
  })

  test('falls back to today when neither is given', () => {
    assert.match(csvFilename('orders'), /^orders-\d{4}-\d{2}-\d{2}\.csv$/)
  })
})
