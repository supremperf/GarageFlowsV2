/**
 * Chiffrement au repos du mot de passe SMTP — round-trip, classification,
 * compat ascendante, migration paresseuse, rotation de clé, robustesse.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import {
  encryptSmtpPass, decryptSmtpPass, isEncryptedSmtp, classifySmtpSecret, reencryptIfLegacy,
} from '../smtp-crypto'

// Secret de session requis par la dérivation "d1" (fail-closed sinon).
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)
})
afterEach(() => {
  delete process.env.GF_SMTP_CIPHER_KEY
})

describe('smtp-crypto — clé dérivée (d1, sans GF_SMTP_CIPHER_KEY)', () => {
  it('round-trip encrypt→decrypt sans fuite du clair', () => {
    delete process.env.GF_SMTP_CIPHER_KEY
    const pass = 'S3cr3t-SMTP!'
    const enc = encryptSmtpPass(pass)
    expect(isEncryptedSmtp(enc)).toBe(true)
    expect(enc.startsWith('gsmtp1.d1.')).toBe(true)
    expect(enc).not.toContain(pass)
    expect(decryptSmtpPass(enc)).toBe(pass)
  })

  it('deux chiffrements du même mot de passe diffèrent (IV aléatoire)', () => {
    delete process.env.GF_SMTP_CIPHER_KEY
    const a = encryptSmtpPass('same')
    const b = encryptSmtpPass('same')
    expect(a).not.toBe(b)
    expect(decryptSmtpPass(a)).toBe('same')
    expect(decryptSmtpPass(b)).toBe('same')
  })
})

describe('smtp-crypto — clé dédiée (k1, GF_SMTP_CIPHER_KEY)', () => {
  it('utilise le keyId k1 et round-trip', () => {
    process.env.GF_SMTP_CIPHER_KEY = 'k'.repeat(40)
    const enc = encryptSmtpPass('hello')
    expect(enc.startsWith('gsmtp1.k1.')).toBe(true)
    expect(decryptSmtpPass(enc)).toBe('hello')
  })
})

describe('smtp-crypto — classification', () => {
  it('distingue absent / encrypted / plaintext / invalid', () => {
    delete process.env.GF_SMTP_CIPHER_KEY
    expect(classifySmtpSecret(null)).toBe('absent')
    expect(classifySmtpSecret('')).toBe('absent')
    expect(classifySmtpSecret('motdepasse-en-clair')).toBe('plaintext')
    expect(classifySmtpSecret(encryptSmtpPass('x'))).toBe('encrypted')
    expect(classifySmtpSecret('gsmtp1.d1.trop.court')).toBe('invalid')
  })
})

describe('smtp-crypto — compat ascendante & migration paresseuse', () => {
  it('renvoie tel quel un ancien mot de passe en clair', () => {
    const legacy = 'ancien-clair'
    expect(isEncryptedSmtp(legacy)).toBe(false)
    expect(decryptSmtpPass(legacy)).toBe(legacy)
  })

  it('reencryptIfLegacy chiffre le clair et laisse le chiffré/absent intact', () => {
    delete process.env.GF_SMTP_CIPHER_KEY
    const upgraded = reencryptIfLegacy('ancien-clair')
    expect(upgraded).not.toBeNull()
    expect(isEncryptedSmtp(upgraded!)).toBe(true)
    expect(decryptSmtpPass(upgraded!)).toBe('ancien-clair')
    // Déjà chiffré → pas de re-chiffrement.
    expect(reencryptIfLegacy(upgraded!)).toBeNull()
    // Absent → rien à migrer.
    expect(reencryptIfLegacy(null)).toBeNull()
    expect(reencryptIfLegacy('')).toBeNull()
  })
})

describe('smtp-crypto — robustesse', () => {
  it('renvoie null sur entrée vide', () => {
    expect(decryptSmtpPass(null)).toBeNull()
    expect(decryptSmtpPass(undefined)).toBeNull()
    expect(decryptSmtpPass('')).toBeNull()
  })
  it('renvoie null si le format chiffré est altéré', () => {
    delete process.env.GF_SMTP_CIPHER_KEY
    const enc = encryptSmtpPass('abc')
    const tampered = enc.slice(0, -4) + 'AAAA'
    expect(decryptSmtpPass(tampered)).toBeNull()
  })
  it('refuse de chiffrer une valeur vide', () => {
    expect(() => encryptSmtpPass('')).toThrow()
  })
})
