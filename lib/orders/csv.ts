/**
 * CSV serialisation for the shop's order export.
 *
 * Pure and dependency-free so it can be unit-tested, which matters more than it
 * sounds: a shop opens this in Excel to reconcile against their own books, and a
 * quoting bug does not throw — it silently shifts one row's columns and makes
 * the totals disagree with nothing to point at.
 *
 * Three Myanmar-specific hazards this handles deliberately:
 *
 *   BOM        Excel on Windows reads a UTF-8 file without a byte-order mark as
 *              the local codepage, which turns every Burmese address into
 *              mojibake. `toCsv` emits one.
 *   CRLF       Excel is happier with CRLF, and RFC 4180 specifies it.
 *   Injection  A value starting with = + - @ is executed as a formula on open.
 *              Prefixing a tab neutralises it without changing what is read.
 */

const NEEDS_QUOTING = /[",\r\n]/
const FORMULA_START = /^[=+\-@\t\r]/

/** One cell. Numbers keep full precision; null/undefined become empty. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''

  let s = String(value)

  // Formula injection: Excel and Sheets both execute a leading =, +, - or @.
  // A leading tab makes it inert, and spreadsheets do not display it.
  if (FORMULA_START.test(s)) s = `\t${s}`

  if (NEEDS_QUOTING.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(',')
}

/**
 * A complete CSV document, ready to send as a file.
 *
 * Returns just the header row when there are no records — an empty file reads
 * as a failed export, whereas headers with no rows reads as "nothing matched".
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const body = [csvRow(headers), ...rows.map(csvRow)].join('\r\n')
  return `﻿${body}\r\n`
}

/** `orders-2026-09-01.csv`, or with a range when one was filtered. */
export function csvFilename(prefix: string, from?: string | null, to?: string | null): string {
  const span = from && to ? `${from}_${to}` : (from ?? to ?? new Date().toISOString().slice(0, 10))
  return `${prefix}-${span}.csv`
}
