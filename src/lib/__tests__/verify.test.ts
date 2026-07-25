/**
 * License token format/structure validation tests.
 *
 * These tests cover the structural checks in verifyLicenseToken without
 * requiring a real signing key — they verify the rejection logic for malformed
 * tokens, which is the most attack-prone surface.
 */
import { describe, it, expect } from 'vitest'
import { verifyLicenseToken } from '../license/verify'

const INVALID_CASES: [string, string | RegExp][] = [
  ['',                         'Format de licence invalide'],
  ['not-a-token',              'Format de licence invalide'],
  ['GF2.abc',                  'Token malformé'],
  ['GF2.abc.def.ghi.extra',    'Token malformé'],
  // Correct 4-segment prefix but garbage base64 header
  ['GF2.!!.abc.def',           /.*/],
]

describe('verifyLicenseToken — structural rejections', () => {
  for (const [token, expectedReason] of INVALID_CASES) {
    it(`rejects token: "${token.slice(0, 30)}"`, () => {
      const r = verifyLicenseToken(token)
      expect(r.valid).toBe(false)
      if (typeof expectedReason === 'string') {
        expect(r.reason).toContain(expectedReason)
      } else {
        expect(r.reason).toMatch(expectedReason)
      }
    })
  }

  it('never throws — always returns a result object', () => {
    const weird = [null, undefined, 0, {}, [], 'GF2.' + 'x'.repeat(1000)] as unknown as string[]
    for (const v of weird) {
      expect(() => verifyLicenseToken(v)).not.toThrow()
      const r = verifyLicenseToken(v)
      expect(typeof r).toBe('object')
      expect(typeof r.valid).toBe('boolean')
    }
  })

  it('returns valid=false for a token with invalid signature', () => {
    // Build a structurally correct but unsigned token
    const header  = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'GF-LIC', v: 2 })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      lid: 'test-lid', cid: 'test-cid', typ: 'premium',
      iss: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
      seats: 1, wm: 'dGVzdA', ver: '2.0',
    })).toString('base64url')
    const fakeSig = Buffer.from('invalidsignature').toString('base64url')
    const token   = `GF2.${header}.${payload}.${fakeSig}`

    const r = verifyLicenseToken(token)
    expect(r.valid).toBe(false)
    // Reason could be crypto error or invalid signature — both are acceptable
    expect(r.reason).toBeTruthy()
  })
})
