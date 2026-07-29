/**
 * VIN validation & check-digit computation (ISO 3779).
 */
import {
  CHECK_DIGIT_WEIGHTS,
  FORBIDDEN_VIN_CHARS,
  TRANSLITERATION,
} from './constants'
import type { VinValidation } from './types'

/** Normalize a raw VIN: trim, uppercase, strip spaces/dashes. */
export function normalizeVin(raw: string): string {
  return String(raw ?? '').toUpperCase().replace(/[\s-]/g, '')
}

/** True if the string is a plausible VIN shape (17 chars, allowed alphabet). */
export function isValidVinFormat(vin: string): boolean {
  if (vin.length !== 17) return false
  if (/[IOQ]/.test(vin)) return false
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin)
}

/**
 * Compute the ISO 3779 check digit (the character that should occupy position 9).
 * Returns '0'–'9' or 'X'. Returns null if the VIN contains an untransliterable char.
 */
export function computeCheckDigit(vin: string): string | null {
  if (vin.length !== 17) return null
  let sum = 0
  for (let i = 0; i < 17; i++) {
    const value = TRANSLITERATION[vin[i]]
    if (value === undefined) return null
    sum += value * CHECK_DIGIT_WEIGHTS[i]
  }
  const mod = sum % 11
  return mod === 10 ? 'X' : String(mod)
}

/** True when the VIN's position-9 character matches its computed check digit. */
export function isCheckDigitValid(vin: string): boolean {
  const expected = computeCheckDigit(vin)
  if (expected === null) return false
  return vin[8] === expected
}

/**
 * Full validation. Reports precise errors and whether the check digit is valid.
 * Note: the check digit is mandatory in North America but frequently absent/
 * non-conforming on European VINs, so an invalid check digit is a warning, not a
 * hard format error.
 */
export function validateVin(raw: string): VinValidation {
  const normalized = normalizeVin(raw)
  const errors: string[] = []

  if (normalized.length === 0) {
    errors.push('VIN vide.')
    return { ok: false, normalized, errors, checkDigitValid: false }
  }
  if (normalized.length !== 17) {
    errors.push(`Longueur invalide : ${normalized.length} caractère(s), 17 attendus.`)
  }
  const bad = FORBIDDEN_VIN_CHARS.filter((c) => normalized.includes(c))
  if (bad.length) {
    errors.push(`Caractères interdits : ${bad.join(', ')} (I, O, Q ne sont jamais utilisés).`)
  }
  if (normalized.length === 17 && !/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized)) {
    errors.push('Caractères non alphanumériques ou hors alphabet VIN.')
  }

  const checkDigitValid = errors.length === 0 && isCheckDigitValid(normalized)

  return { ok: errors.length === 0, normalized, errors, checkDigitValid }
}
