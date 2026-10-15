/**
 * Vérification des tokens MÉCANICIEN (verify.ts).
 *
 * Une paire ECC de test est générée à la volée et la clé publique embarquée est
 * mockée : la vérification de signature est donc RÉELLE.
 */
import { describe, it, expect, vi } from 'vitest'
import crypto from 'crypto'

const { privateKey: PRIV, publicKey: PUB } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const PUB_PEM = PUB.export({ type: 'spki', format: 'pem' }).toString()

vi.mock('../license/public-key', () => ({ getPublicKeyPem: () => PUB_PEM }))

import { verifyLicenseToken } from '../license/verify'

function sign(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'GF-LIC', v: 2 })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createSign('SHA256').update(`${header}.${body}`).sign({ key: PRIV, dsaEncoding: 'der' })
  return `GF2.${header}.${body}.${Buffer.from(sig).toString('base64url')}`
}
const now = Math.floor(Date.now() / 1000)
const garage = (o: Record<string, unknown> = {}) => ({ lid: 'g1', cid: 'C1', typ: 'premium', iss: now, exp: now + 86400, seats: 3, wm: 'dGVzdA', ver: '2.0', ...o })
const mech = (o: Record<string, unknown> = {}) => ({ lid: 'm1', cid: 'C1', typ: 'mechanic', iss: now, exp: now + 86400, seats: 1, wm: 'dGVzdA', ver: '2.1', plid: 'g1', mn: 'Jean', ...o })

describe('verify — token mécanicien', () => {
  it('accepte un token mechanic signé avec plid (isMechanic, jamais admin)', () => {
    const r = verifyLicenseToken(sign(mech()))
    expect(r.valid).toBe(true)
    expect(r.isMechanic).toBe(true)
    expect(r.isAdmin).toBe(false)
    expect(r.payload?.plid).toBe('g1')
  })

  it('refuse un token mechanic SANS plid', () => {
    expect(verifyLicenseToken(sign(mech({ plid: undefined }))).valid).toBe(false)
    expect(verifyLicenseToken(sign(mech({ plid: '' }))).valid).toBe(false)
  })

  it('une clé mechanic ne peut pas se faire passer pour admin', () => {
    // Même en trichant le payload, typ reste 'mechanic' ⇒ isAdmin=false.
    const r = verifyLicenseToken(sign(mech({ mn: 'admin' })))
    expect(r.isAdmin).toBe(false)
  })

  it('les 4 types garage restent valides et non-mechanic', () => {
    for (const typ of ['trial', 'premium', 'enterprise', 'admin']) {
      const r = verifyLicenseToken(sign(garage({ typ, lid: `g-${typ}` })))
      expect(r.valid).toBe(true)
      expect(r.isMechanic).toBe(false)
      expect(r.isAdmin).toBe(typ === 'admin')
    }
  })

  it('rejette une signature invalide (clé étrangère)', () => {
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'GF-LIC', v: 2 })).toString('base64url')
    const body = Buffer.from(JSON.stringify(mech())).toString('base64url')
    const sig = crypto.createSign('SHA256').update(`${header}.${body}`).sign({ key: other, dsaEncoding: 'der' })
    const forged = `GF2.${header}.${body}.${Buffer.from(sig).toString('base64url')}`
    expect(verifyLicenseToken(forged).valid).toBe(false)
  })
})
