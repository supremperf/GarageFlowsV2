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
  let s = value === null || value === undefined ? '' : String(value)
  // Anti-injection de formule (CSV injection) : une cellule débutant par
  // = + - @ (ou TAB/CR) est interprétée comme une FORMULE par Excel/LibreOffice
  // (=HYPERLINK, DDE `=cmd|...`, etc.). Les cellules contiennent des données
  // saisies par l'utilisateur (nom/email/adresse client…) → on préfixe une
  // apostrophe (texte). Exception : un NOMBRE fini (ex. « -50 » pour un avoir)
  // est laissé intact pour rester numérique dans le tableur.
  if (/^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s))) s = "'" + s
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
