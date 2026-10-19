/**
 * Intégrité DB des clés MÉCANICIEN (record-mac) — rétrocompatibilité.
 *
 * Prouve que :
 *  - les licences GARAGE existantes (parent/mechanic nuls) gardent EXACTEMENT le
 *    même MAC qu'avant l'extension (aucune régression) ;
 *  - modifier mechanicId ou parentLicenseId en base invalide le MAC (détection
 *    d'altération — un attaquant ne peut pas réattribuer une clé en base).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { computeRecordMac, verifyRecordMac } from '@/lib/license/record-mac'

beforeAll(() => { process.env.GF_DB_MAC_SECRET = 'test-mac-secret-1234567890' })

const base = {
  licenseId: 'lic-1',
  token: 'GF2.a.b.c',
  status: 'active',
  expiryAt: new Date('2030-01-01T00:00:00.000Z'),
  hwid: null as string | null,
}

describe('record-mac — rétrocompatibilité garage', () => {
  it('une licence garage (parent/mechanic nuls) a le MÊME MAC qu\'avant', () => {
    const legacy = computeRecordMac(base) // sans champs mechanic
    const withNulls = computeRecordMac({ ...base, parentLicenseId: null, mechanicId: null })
    expect(withNulls).toBe(legacy)
    expect(verifyRecordMac({ ...base, parentLicenseId: null, mechanicId: null, recordMac: legacy }).ok).toBe(true)
  })
})

describe('record-mac — clé mécanicien', () => {
  it('le MAC couvre mechanicId et parentLicenseId', () => {
    const mac = computeRecordMac({ ...base, parentLicenseId: 'garage-1', mechanicId: 'mech-A' })

    // MAC valide pour l'état signé.
    expect(verifyRecordMac({ ...base, parentLicenseId: 'garage-1', mechanicId: 'mech-A', recordMac: mac }).tampered).toBe(false)

    // Réattribution frauduleuse en base (mech-A → mech-B) ⇒ MAC invalide.
    expect(verifyRecordMac({ ...base, parentLicenseId: 'garage-1', mechanicId: 'mech-B', recordMac: mac }).tampered).toBe(true)

    // Changement de parent en base ⇒ MAC invalide.
    expect(verifyRecordMac({ ...base, parentLicenseId: 'garage-2', mechanicId: 'mech-A', recordMac: mac }).tampered).toBe(true)
  })

  it('un MAC absent est signalé « missing » (legacy) sans être « tampered »', () => {
    const r = verifyRecordMac({ ...base, parentLicenseId: 'garage-1', mechanicId: 'mech-A', recordMac: null })
    expect(r.missing).toBe(true)
    expect(r.tampered).toBe(false)
  })
})
