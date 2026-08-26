'use client'

/**
 * CSV export.
 *
 * Built in the browser from rows already loaded rather than served from an
 * endpoint: the data is on the page, and a round trip would only add a way
 * for the download to disagree with what is on screen.
 */

/**
 * Quotes a field for Excel and Sheets.
 *
 * A leading =, +, - or @ makes a spreadsheet treat the value as a formula,
 * so a SKU like "-5DG78" would execute rather than display. Prefixing a
 * single quote is the standard defence and both applications strip it on
 * display.
 */
function cell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

export function toCsv(
  headers: string[],
  rows: Array<Array<unknown>>
): string {
  const lines = [headers.map(cell).join(',')]
  for (const r of rows) lines.push(r.map(cell).join(','))
  // CRLF and a BOM: Excel on Windows opens UTF-8 as the local codepage
  // otherwise, which turns every accent in a product name into mojibake.
  return '﻿' + lines.join('\r\n')
}

export function download(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Freed on the next tick rather than immediately — revoking synchronously
  // cancels the download in some browsers before it has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Today as YYYY-MM-DD, for filenames that sort chronologically. */
export const stamp = () => new Date().toISOString().slice(0, 10)
