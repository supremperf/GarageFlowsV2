/**
 * Chiffrement au repos des secrets TOTP — round-trip, compat ascendante, rotation.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { encryptTotpSecret, decryptTotpSecret, isEncryptedTotp } from '../totp-crypto'
import { generateTotpSecret, generateTotp, verifyTotp } from '../totp'

// Secret de session requis par la dérivation "d1" (fail-closed sinon).
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)
})
afterEach(() => {
  delete process.env.GF_TOTP_ENC_KEY
})

describe('totp-crypto — clé dérivée (d1, sans GF_TOTP_ENC_KEY)', () => {
  it('round-trip encrypt→decrypt', () => {
    delete process.env.GF_TOTP_ENC_KEY
    const secret = generateTotpSecret()
    const enc = encryptTotpSecret(secret)
    expect(isEncryptedTotp(enc)).toBe(true)
    expect(enc.startsWith('gtotp1.d1.')).toBe(true)
    expect(enc).not.toContain(secret) // le clair ne fuit pas
    expect(decryptTotpSecret(enc)).toBe(secret)
  })

  it('le secret chiffré reste vérifiable par verifyTotp après déchiffrement', () => {
    delete process.env.GF_TOTP_ENC_KEY
    const secret = generateTotpSecret()
    const enc = encryptTotpSecret(secret)
    const back = decryptTotpSecret(enc)!
    const code = generateTotp(back)
    expect(verifyTotp(code, back)).toBe(true)
  })
})

describe('totp-crypto — clé dédiée (k1, GF_TOTP_ENC_KEY)', () => {
  it('utilise le keyId k1 et round-trip', () => {
    process.env.GF_TOTP_ENC_KEY = 'k'.repeat(40)
    const secret = generateTotpSecret()
    const enc = encryptTotpSecret(secret)
    expect(enc.startsWith('gtotp1.k1.')).toBe(true)
    expect(decryptTotpSecret(enc)).toBe(secret)
  })
})

describe('totp-crypto — compatibilité ascendante & robustesse', () => {
  it('renvoie tel quel un ancien secret en clair (base32)', () => {
    delete process.env.GF_TOTP_ENC_KEY
    const legacy = generateTotpSecret() // base32 nu, non préfixé
    expect(isEncryptedTotp(legacy)).toBe(false)
    expect(decryptTotpSecret(legacy)).toBe(legacy)
  })
  it('renvoie null sur entrée vide', () => {
    expect(decryptTotpSecret(null)).toBeNull()
    expect(decryptTotpSecret('')).toBeNull()
  })
  it('renvoie null si le format chiffré est altéré', () => {
    delete process.env.GF_TOTP_ENC_KEY
    const enc = encryptTotpSecret(generateTotpSecret())
    const tampered = enc.slice(0, -4) + 'AAAA'
    expect(decryptTotpSecret(tampered)).toBeNull()
  })
})
