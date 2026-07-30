/**
 * CSV export (RFC 4180). A field is quoted when it contains the delimiter, a
 * quote, or a newline; embedded quotes are doubled.
 */
import type { ReportResult, Row } from './types'

export interface CsvOptions {
  delimiter?: string // ',' (default) or ';' for FR Excel
  eol?: string // '\r\n' (default)
  header?: boolean // include header row (default true)
}

function escapeField(value: unknown, delimiter: string): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export function rowsToCsv(columns: string[], rows: Row[], opts: CsvOptions = {}): string {
  const delimiter = opts.delimiter ?? ','
  const eol = opts.eol ?? '\r\n'
  const lines: string[] = []
  if (opts.header !== false) lines.push(columns.map((c) => escapeField(c, delimiter)).join(delimiter))
  for (const row of rows) {
    lines.push(columns.map((c) => escapeField(row[c], delimiter)).join(delimiter))
  }
  return lines.join(eol)
}

export function reportToCsv(result: ReportResult, opts: CsvOptions = {}): string {
  return rowsToCsv(result.columns, result.rows, opts)
}
