/**
 * VIN decoding — shared types.
 *
 * A VIN (ISO 3779) is 17 characters:
 *   - positions 1–3  : WMI (World Manufacturer Identifier)
 *   - positions 4–9  : VDS (Vehicle Descriptor Section); position 9 is the check digit
 *   - positions 10–17: VIS (Vehicle Identifier Section); position 10 is the model year,
 *                      position 11 is the assembly plant, 12–17 the serial number
 */

export type VinConfidence = 'high' | 'medium' | 'low'

/** A structured, provider-agnostic decode result. */
export interface VinInfo {
  /** The normalized 17-char VIN. */
  vin: string
  /** WMI (positions 1–3). */
  wmi: string
  /** VDS (positions 4–8, excluding the check digit at 9). */
  vds: string
  /** VIS (positions 10–17). */
  vis: string
  /** Manufacturer/brand when the WMI is known, else null. */
  manufacturer: string | null
  /** ISO 3780 country of manufacture when resolvable, else null. */
  country: string | null
  /** Broad geographic region derived from the first VIN character. */
  region: string | null
  /** Resolved model year (best guess — see modelYearCandidates). */
  modelYear: number | null
  /** All plausible model years for the position-10 code (the 30-year cycle). */
  modelYearCandidates: number[]
  /** Assembly plant code (position 11). */
  plantCode: string | null
  /** Serial number (positions 12–17). */
  serialNumber: string | null
  /** True when the position-9 check digit is mathematically valid (mainly N. America). */
  checkDigitValid: boolean
  /** Whether the check digit is applicable/meaningful for this VIN's region. */
  checkDigitApplicable: boolean
}

/** Result of validating a raw VIN string. */
export interface VinValidation {
  ok: boolean
  /** Normalized VIN (uppercased, trimmed) when the raw length allows it. */
  normalized: string
  errors: string[]
  checkDigitValid: boolean
}

/** A full decode as returned by the engine (offline core + optional providers). */
export interface VinDecodeResult extends VinInfo {
  /** Where the data came from: 'offline' (deterministic), a provider name, or 'cache'. */
  source: string
  confidence: VinConfidence
  /** Non-fatal notes (e.g. "check digit invalid — common on European VINs"). */
  warnings: string[]
}
