/**
 * Garantit que le calcul de recordMac du script de réparation
 * (scripts/repair-after-secret-rotation.js) est STRICTEMENT identique à
 * src/lib/license/record-mac.ts::computeRecordMac — sinon un re-MAC produirait
 * des MAC que l'application rejetterait (licences toujours « tampered »).
 */
import { describe, it, expect } from 'vitest'
import { computeRecordMac as appMac } from '@/lib/license/record-mac'
import { computeRecordMac as scriptMac } from '../../../scripts/repair-after-secret-rotation.js'

const SECRET = 'parity-test-secret-0123456789'
process.env.GF_DB_MAC_SECRET = SECRET

const cases = [
  { name: 'licence garage (ni parent ni mécanicien)', r: { licenseId: 'L-garage', token: 'tok', status: 'active', expiryAt: new Date('2030-01-01T00:00:00.000Z'), hwid: 'HW123', parentLicenseId: null, mechanicId: null } },
  { name: 'licence garage, hwid null', r: { licenseId: 'L2', token: 't2', status: 'suspended', expiryAt: new Date('2028-06-15T12:34:56.000Z'), hwid: null, parentLicenseId: null, mechanicId: null } },
  { name: 'clé mécanicien (parent + mécanicien)', r: { licenseId: 'L-mech', token: 'tok3', status: 'active', expiryAt: new Date('2031-03-03T03:03:03.000Z'), hwid: null, parentLicenseId: 'P-parent', mechanicId: 'M-1' } },
  { name: 'clé mécanicien, mechanicId seul', r: { licenseId: 'L4', token: 't4', status: 'revoked', expiryAt: new Date('2027-12-31T23:59:59.000Z'), hwid: 'HW', parentLicenseId: null, mechanicId: 'M-2' } },
]

describe('parité re-MAC (script JS ↔ record-mac.ts)', () => {
  for (const c of cases) {
    it(`identiques — ${c.name}`, () => {
      const a = appMac(c.r as never)
      const b = (scriptMac as (secret: string, r: unknown) => string)(SECRET, c.r)
      expect(b).toBe(a)
      expect(a).toMatch(/^[0-9a-f]{64}$/)
    })
  }
})
