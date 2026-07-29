/**
 * French licence-plate detection in OCR text. Pure & deterministic.
 *
 * SIV (since 2009): AA-123-AA. FNI (pre-2009): 123 ABC 75 (1–4 digits, 2–3
 * letters, 2-digit department). Returns the canonical hyphenated form.
 */

export type PlateFormat = 'SIV' | 'FNI'

export interface PlateHit {
  plate: string
  format: PlateFormat
  confidence: number
  raw: string
}

const SIV = /\b([A-Z]{2})[-\s]?(\d{3})[-\s]?([A-Z]{2})\b/
const FNI = /\b(\d{1,4})[-\s]?([A-Z]{2,3})[-\s]?(\d{2})\b/

export function findPlate(text: string): PlateHit | null {
  const upper = text.toUpperCase()

  const siv = upper.match(SIV)
  if (siv) {
    // Guard against a 17-char VIN slice masquerading as a plate: reject when the
    // match is embedded in a longer alphanumeric run.
    return { plate: `${siv[1]}-${siv[2]}-${siv[3]}`, format: 'SIV', confidence: 0.9, raw: siv[0] }
  }

  const fni = upper.match(FNI)
  if (fni) {
    return { plate: `${fni[1]}-${fni[2]}-${fni[3]}`, format: 'FNI', confidence: 0.75, raw: fni[0] }
  }

  return null
}
