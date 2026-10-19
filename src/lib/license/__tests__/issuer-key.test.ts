import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadIssuerPrivateKey, describeIssuerKeyFailure, spkiFingerprint } from '@/lib/license/issuer-key'
import { getPublicKeyPem } from '@/lib/license/public-key'

function pair(curve = 'prime256v1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: curve })
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    pub: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  }
}

function emptyDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-issuer-'))
}

describe('loadIssuerPrivateKey — clé d’émission vérifiée avant signature', () => {
  it('accepte la clé qui correspond à la clé publique attendue (base64 et PEM brut)', () => {
    const p = pair()
    for (const value of [Buffer.from(p.priv).toString('base64'), p.priv]) {
      const r = loadIssuerPrivateKey({ env: { GF_PRIVATE_KEY: value }, cwd: emptyDir(), expectedPublicPem: p.pub })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.fingerprint).toBe(spkiFingerprint(p.pub))
    }
  })

  it('REFUSE une clé valide mais différente de la clé publique (cas 29cc… ≠ production)', () => {
    const prod = pair()
    const local = pair()
    const r = loadIssuerPrivateKey({
      env: { GF_PRIVATE_KEY: Buffer.from(local.priv).toString('base64') },
      cwd: emptyDir(),
      expectedPublicPem: prod.pub,
    })
    expect(r).toMatchObject({ ok: false, reason: 'mismatch', source: 'GF_PRIVATE_KEY' })
    if (!r.ok && r.reason === 'mismatch') {
      expect(r.issuerFingerprint).toBe(spkiFingerprint(local.pub))
      expect(r.expectedFingerprint).toBe(spkiFingerprint(prod.pub))
      const msg = describeIssuerKeyFailure(r)
      expect(msg).toContain('Signature refusée')
      expect(msg).not.toContain('PRIVATE KEY')
      expect(msg).not.toContain(local.priv.split('\n')[1])
    }
  })

  it('compare par défaut à la clé publique EMBARQUÉE (une clé aléatoire est refusée)', () => {
    const r = loadIssuerPrivateKey({ env: { GF_PRIVATE_KEY: pair().priv }, cwd: emptyDir() })
    expect(r).toMatchObject({ ok: false, reason: 'mismatch' })
    if (!r.ok && r.reason === 'mismatch') expect(r.expectedFingerprint).toBe(spkiFingerprint(getPublicKeyPem()))
  })

  it('lit keys/private.pem quand GF_PRIVATE_KEY est absente, et le vérifie aussi', () => {
    const p = pair()
    const dir = emptyDir()
    fs.mkdirSync(path.join(dir, 'keys'))
    fs.writeFileSync(path.join(dir, 'keys', 'private.pem'), p.priv)
    expect(loadIssuerPrivateKey({ env: {}, cwd: dir, expectedPublicPem: p.pub }).ok).toBe(true)
    expect(loadIssuerPrivateKey({ env: {}, cwd: dir, expectedPublicPem: pair().pub }))
      .toMatchObject({ ok: false, reason: 'mismatch', source: 'keys/private.pem' })
  })

  it('absente → absent ; illisible ou mauvaise courbe → unreadable, sans écho du contenu', () => {
    expect(loadIssuerPrivateKey({ env: {}, cwd: emptyDir() })).toEqual({ ok: false, reason: 'absent' })
    expect(loadIssuerPrivateKey({ env: { GF_PRIVATE_KEY: 'pas-une-cle' }, cwd: emptyDir() }))
      .toEqual({ ok: false, reason: 'unreadable', source: 'GF_PRIVATE_KEY' })
    const p384 = pair('secp384r1')
    const r = loadIssuerPrivateKey({ env: { GF_PRIVATE_KEY: p384.priv }, cwd: emptyDir(), expectedPublicPem: p384.pub })
    expect(r).toEqual({ ok: false, reason: 'unreadable', source: 'GF_PRIVATE_KEY' })
  })
})
