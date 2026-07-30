import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'crypto'
// Modules CommonJS du process Electron (vérification des mises à jour signées).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const updateVerify = require('../../../electron/update-verify.js')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const semver = require('../../../electron/semver.js')

const KEY_ID = 'test-key'
let privPem = ''

beforeAll(() => {
  const kp = crypto.generateKeyPairSync('ed25519')
  privPem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const pubPem = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  // Injecte la clé de test dans la table des clés publiques embarquées.
  updateVerify.PUBLIC_KEYS[KEY_ID] = pubPem
})

function baseManifest(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    product: 'GarageFlow',
    version: '2.0.0',
    platform: 'win32',
    architecture: 'x64',
    channel: 'stable',
    downloadUrl: 'https://api.garageflows.fr/downloads/2.0.0',
    sha256: 'a'.repeat(64),
    size: 1000,
    publishedAt: '2026-07-30T00:00:00.000Z',
    minimumSupportedVersion: '1.0.0',
    mandatory: false,
    rolloutPercentage: 100,
    releaseId: 'rel_1',
    keyId: KEY_ID,
    signatureAlgorithm: 'Ed25519',
    ...over,
  }
}

function sign(manifest: Record<string, unknown>) {
  const data = Buffer.from(updateVerify.canonicalize(manifest), 'utf8')
  const signature = crypto.sign(null, data, crypto.createPrivateKey(privPem)).toString('base64')
  return { manifest, signature }
}

const OPTS = { currentVersion: '1.5.0', channel: 'stable', platform: 'win32', arch: 'x64' }

describe('electron/semver — comparaison correcte', () => {
  it('1.9.0 < 1.10.0 (pas lexicographique)', () => {
    expect(semver.isNewer('1.10.0', '1.9.0')).toBe(true)
    expect(semver.compareVersions('1.9.0', '1.10.0')).toBe(-1)
  })
  it('2.0.0 > 1.99.99 ; préversion < stable', () => {
    expect(semver.isNewer('2.0.0', '1.99.99')).toBe(true)
    expect(semver.isNewer('1.0.0-beta.1', '1.0.0')).toBe(false)
  })
})

describe('electron/update-verify — manifeste signé', () => {
  it('ACCEPTE un manifeste valide, signé, plus récent', () => {
    const r = updateVerify.validateManifest(sign(baseManifest()), OPTS)
    expect(r.ok).toBe(true)
  })

  it('REFUSE une signature invalide (manifeste modifié après signature)', () => {
    const signed = sign(baseManifest())
    signed.manifest.sha256 = 'b'.repeat(64) // altéré après signature
    const r = updateVerify.validateManifest(signed, OPTS)
    expect(r.ok).toBe(false)
  })

  it('REFUSE un keyId inconnu', () => {
    const r = updateVerify.validateManifest(sign(baseManifest({ keyId: 'inconnu' })), OPTS)
    expect(r.ok).toBe(false)
  })

  it('REFUSE une mauvaise plateforme / architecture', () => {
    expect(updateVerify.validateManifest(sign(baseManifest({ platform: 'darwin' })), OPTS).ok).toBe(false)
    expect(updateVerify.validateManifest(sign(baseManifest({ architecture: 'arm64' })), OPTS).ok).toBe(false)
  })

  it('REFUSE un mauvais canal', () => {
    const r = updateVerify.validateManifest(sign(baseManifest({ channel: 'beta' })), OPTS)
    expect(r.ok).toBe(false)
  })

  it('REFUSE un downgrade (version <= installée)', () => {
    const r = updateVerify.validateManifest(sign(baseManifest({ version: '1.0.0' })), { ...OPTS, currentVersion: '1.5.0' })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/supérieure/i)
  })

  it("REFUSE une URL de téléchargement hors domaine autorisé (open redirect)", () => {
    const r = updateVerify.validateManifest(sign(baseManifest({ downloadUrl: 'https://evil.example/x.exe' })), OPTS)
    expect(r.ok).toBe(false)
  })

  it('REFUSE une URL non-HTTPS', () => {
    const r = updateVerify.validateManifest(sign(baseManifest({ downloadUrl: 'http://api.garageflows.fr/x.exe' })), OPTS)
    expect(r.ok).toBe(false)
  })

  it('REFUSE un mauvais produit', () => {
    expect(updateVerify.validateManifest(sign(baseManifest({ product: 'Autre' })), OPTS).ok).toBe(false)
  })

  it('REFUSE un SHA-256 mal formé', () => {
    expect(updateVerify.validateManifest(sign(baseManifest({ sha256: 'xyz' })), OPTS).ok).toBe(false)
  })
})
