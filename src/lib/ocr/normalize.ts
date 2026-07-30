/**
 * OCR text helpers — normalisation, French amount/date parsing, VIN/plate
 * cleanup. Pure & deterministic.
 */

/** Strip diacritics. */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Lowercased, accent-free key for keyword/label matching. */
export function accentInsensitive(s: string | null | undefined): string {
  return stripAccents(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Split raw OCR text into trimmed, non-empty lines. */
export function normalizeLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[\t ]+/g, ' ').trim())
    .filter((l) => l.length > 0)
}

/**
 * Parse a French-formatted monetary amount to a number, or null.
 * Handles "1 234,56", "1.234,56", "1234.56" and NBSP/narrow-NBSP thousands
 * separators (JS \s already covers U+00A0 and U+202F).
 */
export function parseFrAmount(s: string): number | null {
  const m = s.match(/-?\d[\d.,\s]*\d|-?\d/)
  if (!m) return null
  let t = m[0].replace(/\s/g, '')
  const hasComma = t.includes(',')
  const hasDot = t.includes('.')
  if (hasComma && hasDot) {
    // Whichever separator comes last is the decimal separator.
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.')
    else t = t.replace(/,/g, '')
  } else if (hasComma) {
    t = t.replace(/,/g, '.')
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse a French date (dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy, 2- or 4-digit year)
 * to ISO yyyy-mm-dd, or null if absent/invalid.
 */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

export function parseFrDate(s: string): string | null {
  const m = s.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/)
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  let y = Number(m[3])
  if (y < 100) y += y < 50 ? 2000 : 1900
  if (mo < 1 || mo > 12 || d < 1) return null
  // Reject impossible calendar days (e.g. 31/04, 29/02 on a non-leap year), which
  // also filters date-shaped noise like dotted phone numbers.
  const maxDay = mo === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[mo - 1]
  if (d > maxDay) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Correct the OCR characters that cannot legally appear in a VIN: I to 1,
 * O to 0, Q to 0. Applied only in a VIN context (never to free text), so safe.
 */
export function ocrFixVin(token: string): string {
  return token.toUpperCase().replace(/[IOQ]/g, (c) => (c === 'I' ? '1' : '0'))
}
