/**
 * Offline VIN decoder (ISO 3779 / ISO 3780) — deterministic, no network.
 *
 * Extracts every field that can be derived from the VIN structure itself:
 * WMI/manufacturer, country, region, model year (with cycle disambiguation),
 * plant code and serial number, plus check-digit validity.
 */
import {
  COUNTRY_BY_PREFIX,
  MODEL_YEAR_CODES,
  REGION_BY_FIRST_CHAR,
  WMI_MANUFACTURERS,
} from './constants'
import type { VinInfo } from './types'
import { isCheckDigitValid, isValidVinFormat, normalizeVin } from './validate'

/** Region from the first VIN character. */
export function regionFromVin(vin: string): string | null {
  const first = vin[0]
  for (const { match, region } of REGION_BY_FIRST_CHAR) {
    if (match.test(first)) return region
  }
  return null
}

/** ISO 3780 country from the first two VIN characters. */
export function countryFromVin(vin: string): string | null {
  const prefix = vin.slice(0, 2)
  for (const { from, to, country } of COUNTRY_BY_PREFIX) {
    if (prefix >= from && prefix <= to) return country
  }
  return null
}

/** Manufacturer from the WMI (first 3 characters), else null. */
export function manufacturerFromVin(vin: string): string | null {
  return WMI_MANUFACTURERS[vin.slice(0, 3)] ?? null
}

/**
 * Decode the model year. Returns the resolved best guess plus every candidate in
 * the 30-year cycle. Disambiguation heuristic (passenger cars): a LETTER at
 * position 7 indicates the 2010+ cycle, a DIGIT indicates the 1980–2009 cycle.
 */
export function modelYearFromVin(
  vin: string,
  nowYear: number = new Date().getFullYear(),
): { resolved: number | null; candidates: number[] } {
  const code = vin[9] // position 10
  const idx = MODEL_YEAR_CODES.indexOf(code as (typeof MODEL_YEAR_CODES)[number])
  if (idx === -1) return { resolved: null, candidates: [] }

  const candidates: number[] = []
  for (let base = 1980; base <= nowYear + 1; base += 30) {
    const y = base + idx
    if (y >= 1980 && y <= nowYear + 1) candidates.push(y)
  }
  if (candidates.length === 0) return { resolved: null, candidates: [] }

  const pos7 = vin[6]
  const prefers2010Plus = /[A-Z]/.test(pos7) // letter → newer cycle
  // Prefer the newest plausible candidate matching the position-7 hint.
  const preferred = prefers2010Plus
    ? [...candidates].reverse().find((y) => y >= 2010)
    : [...candidates].reverse().find((y) => y <= 2009)
  const resolved = preferred ?? candidates[candidates.length - 1]

  return { resolved, candidates }
}

/**
 * Full offline decode. Accepts a raw or normalized VIN; returns null when the VIN
 * is not a valid 17-char shape (callers should validate first for error detail).
 */
export function decodeVinOffline(
  raw: string,
  nowYear: number = new Date().getFullYear(),
): VinInfo | null {
  const vin = normalizeVin(raw)
  if (!isValidVinFormat(vin)) return null

  const { resolved, candidates } = modelYearFromVin(vin, nowYear)
  const region = regionFromVin(vin)
  // The check digit is mandatory in North America; treat it as "applicable" there.
  const checkDigitApplicable = region === 'Amérique du Nord'

  return {
    vin,
    wmi: vin.slice(0, 3),
    vds: vin.slice(3, 8),
    vis: vin.slice(9, 17),
    manufacturer: manufacturerFromVin(vin),
    country: countryFromVin(vin),
    region,
    modelYear: resolved,
    modelYearCandidates: candidates,
    plantCode: vin[10] ?? null,
    serialNumber: vin.slice(11, 17) || null,
    checkDigitValid: isCheckDigitValid(vin),
    checkDigitApplicable,
  }
}
