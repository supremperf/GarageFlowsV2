/**
 * OBD-II fault-code decoding (SAE J2012 structure).
 *
 * A code is a letter + 4 characters:
 *   letter : P powertrain, C chassis, B body, U network
 *   char 2 : 0 = SAE generic, 1/2/3 = manufacturer-specific
 *   char 3 : (powertrain) subsystem group
 */
import type { DecodedObdCode } from './types'

const SYSTEM: Record<string, DecodedObdCode['system']> = {
  P: 'powertrain',
  C: 'chassis',
  B: 'body',
  U: 'network',
}

const P_SUBSYSTEM: Record<string, string> = {
  '0': 'Dosage air/carburant',
  '1': 'Dosage air/carburant',
  '2': 'Circuit injecteurs',
  '3': 'Allumage / ratés de combustion',
  '4': 'Systèmes antipollution auxiliaires',
  '5': 'Régime / ralenti',
  '6': 'Calculateur & sorties',
  '7': 'Transmission',
  '8': 'Transmission',
  '9': 'Transmission',
  A: 'Propulsion hybride',
  B: 'Propulsion hybride',
  C: 'Propulsion hybride',
}

/** Well-known code descriptions (FR). */
export const OBD_DESCRIPTIONS: Record<string, string> = {
  P0300: 'Ratés de combustion aléatoires / multiples',
  P0301: 'Ratés de combustion — cylindre 1',
  P0302: 'Ratés de combustion — cylindre 2',
  P0303: 'Ratés de combustion — cylindre 3',
  P0304: 'Ratés de combustion — cylindre 4',
  P0171: 'Mélange trop pauvre (banc 1)',
  P0174: 'Mélange trop pauvre (banc 2)',
  P0172: 'Mélange trop riche (banc 1)',
  P0420: 'Rendement catalyseur insuffisant (banc 1)',
  P0128: 'Thermostat — température moteur trop basse',
  P0401: 'Débit EGR insuffisant',
  P0087: 'Pression de rampe carburant trop basse',
  P0442: 'Petite fuite du système EVAP',
}

export function decodeObdCode(raw: string): DecodedObdCode {
  const code = String(raw ?? '').toUpperCase().trim()
  const valid = /^[PCBU][0-3][0-9A-F]{3}$/.test(code)
  if (!valid) {
    return { code, valid: false, system: 'unknown', scope: 'unknown', subsystem: null, description: 'Code OBD invalide' }
  }
  const system = SYSTEM[code[0]] ?? 'unknown'
  const scope: DecodedObdCode['scope'] = code[1] === '0' ? 'generic' : 'manufacturer'
  const subsystem = system === 'powertrain' ? (P_SUBSYSTEM[code[2]] ?? null) : null
  const description =
    OBD_DESCRIPTIONS[code] ??
    `Code ${system}${scope === 'manufacturer' ? ' (spécifique constructeur)' : ''}${subsystem ? ` — ${subsystem}` : ''}`
  return { code, valid: true, system, scope, subsystem, description }
}
