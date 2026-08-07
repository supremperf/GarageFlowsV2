/**
 * Licence — compatibilité de FORMAT cross-langage keygen(Python) → verify(Node).
 *
 * Objectif (Phase 10 « matrice licences ») : prouver qu'un jeton construit selon
 * la spécification EXACTE de l'outil officiel `scripts/keygen_core.py` est
 * accepté par le vérificateur de production `verifyLicenseToken`, pour chaque
 * type de licence, et rejeté quand il le doit.
 *
 * HONNÊTETÉ D'ENVIRONNEMENT : le binding natif de la lib Python `cryptography`
 * est cassé dans ce conteneur (`_cffi_backend` absent) — on ne PEUT donc pas
 * exécuter keygen_core.py ici, et on ne feint pas de l'avoir fait. On reproduit
 * à la place, en Node, le format d'onde EXACT de keygen_core._sign (vérifié sur
 * sa source) :
 *   header  = {"alg":"ES256","typ":"GF-LIC","v":2}         (JSON compact)
 *   b64url  = base64url SANS padding                        (rstrip('='))
 *   token   = GF2.<headerB64>.<payloadB64>.<sigB64url>
 *   sig     = ECDSA-SHA256, DER, sur "<headerB64>.<payloadB64>" (ASCII)
 * Les deux côtés utilisant le DER ECDSA P-256 standard, l'acceptation d'un jeton
 * à ce format par le vérificateur établit la compatibilité Python↔Node.
 *
 * Une clé publique ÉPHÉMÈRE (générée ici) est injectée à la place de la clé
 * embarquée — on teste le FORMAT/algorithme, pas la clé de production (jamais
 * dans le dépôt).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import crypto from 'node:crypto'

const h = vi.hoisted(() => ({ pubPem: '' }))
vi.mock('@/lib/license/public-key', () => ({ getPublicKeyPem: () => h.pubPem }))

import { verifyLicenseToken, isValidHwidFormat, verifyHwid } from '@/lib/license/verify'

// ── Reproduction fidèle du format keygen_core._sign ─────────────────────────────
const HEADER = { alg: 'ES256', typ: 'GF-LIC', v: 2 }
const b64u = (buf: Buffer) => buf.toString('base64url') // Node base64url = sans padding
const HEADER_B64 = b64u(Buffer.from(JSON.stringify(HEADER)))

let privateKey: crypto.KeyObject

function sign(payload: Record<string, unknown>): string {
  const payloadB64 = b64u(Buffer.from(JSON.stringify(payload)))
  const signingInput = `${HEADER_B64}.${payloadB64}`
  // Node crypto.sign pour une clé EC produit du DER par défaut — comme la lib
  // Python `cryptography` (priv.sign(..., ec.ECDSA(SHA256))).
  const sig = crypto.sign('sha256', Buffer.from(signingInput, 'ascii'), privateKey)
  return `GF2.${HEADER_B64}.${payloadB64}.${b64u(sig)}`
}

const nowSec = () => Math.floor(Date.now() / 1000)
const wm = () => b64u(Buffer.from(JSON.stringify({ c: 'CUST', t: nowSec(), r: 'abcdef', l: '' })))

/** Réplique make_license : payload garage (ver 2.0). */
function garageLicense(typ: string, opts: { seats?: number; hwid?: string; years?: number } = {}) {
  const iss = nowSec()
  const exp = iss + (opts.years ?? 1) * 365 * 24 * 3600
  const p: Record<string, unknown> = { lid: crypto.randomUUID(), cid: 'CUST-1', typ, iss, exp, seats: opts.seats ?? 1, wm: wm(), ver: '2.0' }
  if (opts.hwid) p.hwid = opts.hwid
  return { token: sign(p), lid: p.lid as string }
}

/** Réplique make_mechanic_license : payload mécanicien (ver 2.1, plid obligatoire). */
function mechanicLicense(parentLid: string, opts: { mn?: string; hwid?: string } = {}) {
  const iss = nowSec()
  const exp = iss + 365 * 24 * 3600
  const p: Record<string, unknown> = { lid: crypto.randomUUID(), cid: 'CUST-1', typ: 'mechanic', iss, exp, seats: 1, wm: wm(), ver: '2.1', plid: parentLid }
  if (opts.mn) p.mn = opts.mn
  if (opts.hwid) p.hwid = opts.hwid
  return { token: sign(p) }
}

beforeAll(() => {
  const { publicKey, privateKey: priv } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  privateKey = priv
  h.pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
})

describe('matrice licences — format officiel keygen → verifyLicenseToken', () => {
  it('premium avec HWID → VALIDE', () => {
    const { token } = garageLicense('premium', { seats: 3, hwid: 'a'.repeat(64) })
    const r = verifyLicenseToken(token)
    expect(r.valid).toBe(true)
    expect(r.payload?.typ).toBe('premium')
    expect(r.payload?.seats).toBe(3)
    expect(r.isAdmin).toBe(false)
    expect(r.isMechanic).toBe(false)
  })

  it('enterprise multi-sièges → VALIDE', () => {
    const { token } = garageLicense('enterprise', { seats: 10, years: 2 })
    const r = verifyLicenseToken(token)
    expect(r.valid).toBe(true)
    expect(r.payload?.typ).toBe('enterprise')
  })

  it('trial → VALIDE', () => {
    const r = verifyLicenseToken(garageLicense('trial').token)
    expect(r.valid).toBe(true)
  })

  it('admin → VALIDE + isAdmin', () => {
    const r = verifyLicenseToken(garageLicense('admin').token)
    expect(r.valid).toBe(true)
    expect(r.isAdmin).toBe(true)
  })

  it('mécanicien avec plid parent → VALIDE + isMechanic, jamais admin', () => {
    const parent = garageLicense('premium')
    const r = verifyLicenseToken(mechanicLicense(parent.lid, { mn: 'Léa' }).token)
    expect(r.valid).toBe(true)
    expect(r.isMechanic).toBe(true)
    expect(r.isAdmin).toBe(false)
  })

  it('licence EXPIRÉE → REJETÉE', () => {
    const { token } = garageLicense('premium', { years: -1 })
    const r = verifyLicenseToken(token)
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/expir/i)
  })

  it('signature ALTÉRÉE → REJETÉE', () => {
    const { token } = garageLicense('premium')
    const parts = token.split('.')
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('A') ? 'BB' : 'AA')
    expect(verifyLicenseToken(parts.join('.')).valid).toBe(false)
  })

  it('payload MODIFIÉ (sièges gonflés) sous une signature valide → REJETÉ', () => {
    // On resigne PAS : on remplace le payload → la signature ne correspond plus.
    const { token } = garageLicense('premium', { seats: 1 })
    const parts = token.split('.')
    parts[2] = b64u(Buffer.from(JSON.stringify({ lid: 'x', cid: 'CUST-1', typ: 'premium', iss: nowSec(), exp: nowSec() + 9e6, seats: 9999, wm: wm(), ver: '2.0' })))
    expect(verifyLicenseToken(parts.join('.')).valid).toBe(false)
  })

  it('mécanicien SANS plid → REJETÉ (ne peut exister seul)', () => {
    const iss = nowSec()
    const p = { lid: crypto.randomUUID(), cid: 'CUST-1', typ: 'mechanic', iss, exp: iss + 9e6, seats: 1, wm: wm(), ver: '2.1' }
    expect(verifyLicenseToken(sign(p)).valid).toBe(false)
  })

  it('clé publique DIFFÉRENTE → REJETÉ (signature d’une autre paire)', () => {
    const { token } = garageLicense('premium')
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    h.pubPem = other.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(verifyLicenseToken(token).valid).toBe(false)
    // restaure pour les tests suivants (ordre non garanti → on régénère)
    const back = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    privateKey = back.privateKey
    h.pubPem = back.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  })
})

describe('HWID — format keygen (SHA-256 hex) compatible avec la vérification Node', () => {
  it('un HWID keygen (64 hex) est bien formé et se compare strictement', () => {
    const hwid = crypto.createHash('sha256').update('cpu||mac||plat||host||disk').digest('hex')
    expect(isValidHwidFormat(hwid)).toBe(true)
    expect(verifyHwid(hwid, hwid.toUpperCase())).toBe(true) // insensible à la casse
    expect(verifyHwid(hwid, 'b'.repeat(64))).toBe(false)     // machine différente
  })
})
