/**
 * VIN detection in OCR text. Pure & deterministic — reuses the VIN engine's
 * validators. Applies VIN-context OCR correction (I/O/Q) before validating.
 */
import { isValidVinFormat, isCheckDigitValid } from '@/lib/vin'
import { ocrFixVin } from './normalize'

export interface VinHit {
  vin: string
  validFormat: boolean
  checkDigitValid: boolean
  confidence: number
  raw: string
}

/**
 * Scan for the best VIN candidate. Tokens of 17 alphanumerics are OCR-corrected
 * then validated; a valid check digit and proximity to a « E » / « VIN » label
 * raise confidence. Returns null when no 17-char candidate is found.
 */
export function findVin(text: string): VinHit | null {
  const upper = text.toUpperCase()
  const tokens = upper.match(/[A-Z0-9]{17}/g)
  if (!tokens) return null

  let best: VinHit | null = null
  for (const token of tokens) {
    const vin = ocrFixVin(token)
    if (!isValidVinFormat(vin)) continue
    const cd = isCheckDigitValid(vin)
    // Base 0.7 for a well-formed VIN; +0.2 for a valid check digit; +0.1 when a
    // VIN label sits nearby (European VINs frequently fail the NA check digit).
    const labelled = new RegExp(`(?:VIN|CHASSIS|\\bE\\b)[^A-Z0-9]{0,4}${token}`).test(upper)
    const confidence = Math.min(1, 0.7 + (cd ? 0.2 : 0) + (labelled ? 0.1 : 0))
    if (!best || confidence > best.confidence) {
      best = { vin, validFormat: true, checkDigitValid: cd, confidence, raw: token }
    }
  }
  return best
}
