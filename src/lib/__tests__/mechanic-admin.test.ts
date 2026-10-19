/**
 * Correction §4 — validation stricte de GF_MAX_MECHANIC_KEYS et stabilité du MAC.
 *
 * getMaxMechanicKeys() ne doit JAMAIS renvoyer NaN (l'ancien `Number(x)` rendait
 * le plafond inopérant : `count >= NaN` est toujours faux) : toute valeur invalide
 * lève MechanicConfigError.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  getMaxMechanicKeys,
  MechanicConfigError,
  MechanicKeyCapError,
  macFor,
} from '@/lib/license/mechanic-admin'

const ORIGINAL = process.env.GF_MAX_MECHANIC_KEYS
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.GF_MAX_MECHANIC_KEYS
  else process.env.GF_MAX_MECHANIC_KEYS = ORIGINAL
})

describe('getMaxMechanicKeys (§4 — jamais de plafond NaN)', () => {
  it('défaut 20 quand absent', () => {
    delete process.env.GF_MAX_MECHANIC_KEYS
    expect(getMaxMechanicKeys()).toBe(20)
  })
  it('défaut 20 quand vide / espaces', () => {
    for (const v of ['', '   ']) {
      process.env.GF_MAX_MECHANIC_KEYS = v
      expect(getMaxMechanicKeys()).toBe(20)
    }
  })
  it('accepte un entier strictement positif', () => {
    process.env.GF_MAX_MECHANIC_KEYS = '5'
    expect(getMaxMechanicKeys()).toBe(5)
    process.env.GF_MAX_MECHANIC_KEYS = '100'
    expect(getMaxMechanicKeys()).toBe(100)
  })
  it('LÈVE sur valeur invalide (NaN / 0 / négatif / non entier)', () => {
    for (const v of ['abc', '0', '-1', '3.5', 'NaN']) {
      process.env.GF_MAX_MECHANIC_KEYS = v
      expect(() => getMaxMechanicKeys()).toThrow(MechanicConfigError)
    }
  })
})

describe('erreurs & MAC', () => {
  it('MechanicKeyCapError porte le plafond dans son message', () => {
    const e = new MechanicKeyCapError(7)
    expect(e.max).toBe(7)
    expect(e.message).toContain('7')
  })
  it('macFor est déterministe et dépend des champs de sécurité', () => {
    process.env.GF_DB_MAC_SECRET = 'test-mac'
    const base = {
      licenseId: 'lid1', token: 'tok', status: 'active',
      expiryAt: new Date('2030-01-01T00:00:00Z'), hwid: null,
      parentLicenseId: 'plid1', mechanicId: 'mech1',
    }
    const a = macFor(base)
    expect(macFor({ ...base })).toBe(a)
    // Changer le mécanicien change le MAC (anti-usurpation en base).
    expect(macFor({ ...base, mechanicId: 'mech2' })).not.toBe(a)
  })
})
