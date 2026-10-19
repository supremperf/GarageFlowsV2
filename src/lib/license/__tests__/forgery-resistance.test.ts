/**
 * RÉSISTANCE À LA FORGE DE LICENCES — après rotation de la clé de signature.
 *
 * Contexte : la clé privée de signature a été distribuée dans des artefacts
 * Electron (`resources/standalone/keys/private.pem`), dont un installateur
 * servi par le serveur de mise à jour. Quiconque l'a récupérée peut signer des
 * jetons parfaitement valides pour la clé correspondante.
 *
 * La seule protection réelle est donc que la clé sortante ne soit plus acceptée
 * NULLE PART. Le test central est le n° 4 : une licence FRAÎCHEMENT forgée avec
 * l'ancienne clé privée doit être REFUSÉE — sans quoi la rotation ne sert à
 * rien.
 *
 * Les paires utilisées ici sont générées à la volée : aucun secret réel n'est
 * écrit dans le dépôt.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPairSync, createSign, createHash, type KeyObject } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { getPublicKeyPem } from '@/lib/license/public-key'

const ROOT = path.resolve(__dirname, '../../../..')
/** Clé publique ÉMETTRICE : présente sur le poste de signature, jamais versionnée. */
const PUBLIC_PEM = path.join(ROOT, 'keys', 'public.pem')

/** Empreinte SPKI d'une clé publique PEM. */
function fingerprint(pem: string): string {
  const { createPublicKey } = require('crypto') as typeof import('crypto')
  return createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex')
}

const b64u = (b: Buffer) => b.toString('base64url')

/** Fabrique un jeton GF2 signé par la clé privée donnée (format keygen_core). */
function mintToken(privateKey: KeyObject, payload: Record<string, unknown>): string {
  const header = b64u(Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'GF-LIC', v: 2 })))
  const body = b64u(Buffer.from(JSON.stringify(payload)))
  const signer = createSign('SHA256')
  signer.update(`${header}.${body}`)
  signer.end()
  // Python `cryptography` produit une signature DER : Node fait de même par défaut.
  const sig = signer.sign(privateKey)
  return `GF2.${header}.${body}.${b64u(sig)}`
}

/** Charge utile alignée sur celle réellement émise par keygen_core (v2.1). */
function basePayload(over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return {
    lid: '11111111-2222-3333-4444-555555555555',
    cid: 'CLIENT-TEST',
    typ: 'premium',
    iss: now,
    exp: now + 365 * 86400,
    seats: 1,
    wm: 'dGVzdA',
    ver: '2.1',
    ...over,
  }
}

let verifyLicenseToken: typeof import('@/lib/license/verify').verifyLicenseToken
/** Paire SORTANTE : simule la clé compromise, distribuée dans les artefacts. */
let retired: { publicKey: KeyObject; privateKey: KeyObject }

/**
 * Clé privée ÉMETTRICE. Elle ne doit JAMAIS être versionnée : elle n'existe que
 * sur le poste autorisé à signer. Les cas « licence acceptée » ne peuvent donc
 * s'exécuter que là — ailleurs ils sont explicitement IGNORÉS (jamais
 * silencieusement verts).
 */
function loadIssuingKey(): { publicKey: KeyObject; privateKey: KeyObject } | null {
  try {
    const { createPrivateKey, createPublicKey } = require('crypto') as typeof import('crypto')
    const priv = createPrivateKey(readFileSync(path.join(ROOT, 'keys', 'private.pem'), 'utf8'))
    return { privateKey: priv, publicKey: createPublicKey(priv) }
  } catch {
    return null
  }
}
const current = loadIssuingKey()
const SANS_CLE = current === null

beforeAll(async () => {
  ({ verifyLicenseToken } = await import('@/lib/license/verify'))
  retired = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
})

describe('Clé embarquée', () => {
  // `keys/*.pem` est ignoré par git (.gitignore) et aucun fichier de `keys/`
  // n'est suivi : sur un clone neuf, ce fichier N'EXISTE PAS. Sans garde, cette
  // assertion levait ENOENT et faisait échouer `npm test` dans TOUT
  // environnement propre — l'échec ne signalait alors pas une dérive de clé mais
  // l'absence du poste de signature. Même garde que la vérification jumelle de
  // `src/lib/__tests__/license-public-key.test.ts` (`it.skipIf(!existsSync(PEM))`),
  // qui couvre exactement le même invariant là où la clé est présente.
  it.skipIf(!existsSync(PUBLIC_PEM))('correspond à keys/public.pem (clé émettrice réelle)', () => {
    const pem = readFileSync(PUBLIC_PEM, 'utf8')
    expect(fingerprint(getPublicKeyPem())).toBe(fingerprint(pem))
  })

  it('n’est AUCUNE des empreintes retirées', () => {
    const src = readFileSync(path.join(ROOT, 'scripts', 'check-critical-files.js'), 'utf8')
    const block = src.match(/const\s+RETIRED_FINGERPRINTS\s*=\s*\[([\s\S]*?)\n\]/)?.[1] ?? ''
    const retiredFps = Array.from(block.matchAll(/fp:\s*'([0-9a-f]{64})'/g), (m) => m[1])
    expect(retiredFps.length).toBeGreaterThan(0)
    expect(retiredFps).not.toContain(fingerprint(getPublicKeyPem()))
  })
})

describe('Acceptation / refus des licences', () => {
  it.skipIf(SANS_CLE)('1. licence signée par la clé COURANTE → acceptée', () => {
    const res = verifyLicenseToken(mintToken(current!.privateKey, basePayload()))
    expect(res.valid, res.reason).toBe(true)
  })

  it.skipIf(SANS_CLE)('2. licence ALTÉRÉE → refusée', () => {
    const token = mintToken(current!.privateKey, basePayload())
    const parts = token.split('.')
    // On gonfle les sièges dans la charge utile SANS re-signer.
    const tampered = JSON.parse(Buffer.from(parts[2], 'base64url').toString())
    tampered.seats = 999
    parts[2] = b64u(Buffer.from(JSON.stringify(tampered)))
    expect(verifyLicenseToken(parts.join('.')).valid).toBe(false)
  })

  it('3. licence signée par une clé QUELCONQUE → refusée', () => {
    const autre = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    expect(verifyLicenseToken(mintToken(autre.privateKey, basePayload())).valid).toBe(false)
  })

  it('4. licence NEUVE forgée avec la clé SORTANTE → refusée (cœur de la rotation)', () => {
    // Scénario réel : un tiers a extrait private.pem d'un installateur publié
    // et s'en sert pour émettre une licence flambant neuve.
    const forgee = mintToken(retired.privateKey, basePayload({ typ: 'enterprise', seats: 99 }))
    const res = verifyLicenseToken(forgee)
    expect(res.valid).toBe(false)
    expect(res.reason ?? '').toBeTruthy()
  })

  it.skipIf(SANS_CLE)('5. licence expirée → refusée', () => {
    const past = Math.floor(Date.now() / 1000) - 86400
    const res = verifyLicenseToken(mintToken(current!.privateKey, basePayload({ iat: past - 10, exp: past })))
    expect(res.valid).toBe(false)
  })

  it('6. jeton malformé / vide / bruit → refusé sans lever', () => {
    for (const t of ['', 'n’importe quoi', 'GF2.a.b', 'GF2.a.b.c', 'GF1.a.b.c']) {
      expect(() => verifyLicenseToken(t)).not.toThrow()
      expect(verifyLicenseToken(t).valid).toBe(false)
    }
  })

  // Ce refus ne dépend d’aucune signature valide ni de la clé émettrice.
  it('7. en-tête d’algorithme détourné (alg: none) → refusé', () => {
    const header = b64u(Buffer.from(JSON.stringify({ alg: 'none', typ: 'GF-LIC', v: 2 })))
    const body = b64u(Buffer.from(JSON.stringify(basePayload())))
    expect(verifyLicenseToken(`GF2.${header}.${body}.`).valid).toBe(false)
  })

  it.skipIf(SANS_CLE)('8. licence mécanicien sans parent → refusée', () => {
    const res = verifyLicenseToken(mintToken(current!.privateKey, basePayload({ typ: 'mechanic' })))
    expect(res.valid).toBe(false)
  })
})
