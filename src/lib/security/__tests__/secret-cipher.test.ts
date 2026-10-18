import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
  secretCipherConfigured,
  PREFIX,
} from '../secret-cipher'

const KEY_A = crypto.randomBytes(32).toString('base64')
const KEY_B = crypto.randomBytes(32).toString('base64')

const savedEnv: Record<string, string | undefined> = {}
function setEnv(k: string, v: string | undefined) {
  savedEnv[k] = process.env[k]
  if (v === undefined) delete process.env[k]
  else process.env[k] = v
}

beforeEach(() => {
  setEnv('GF_SMTP_CIPHER_KEY', KEY_A)
  setEnv('GF_SMTP_CIPHER_KEY_OLD', undefined)
})
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('secret-cipher — round-trip', () => {
  it('encrypts then decrypts back to the original secret', () => {
    const secret = 'super-smtp-p@ssw0rd-éàü'
    const enc = encryptSecret(secret)
    expect(enc.startsWith(PREFIX)).toBe(true)
    expect(enc).not.toContain(secret) // le clair ne fuit pas dans le chiffré
    expect(isEncryptedSecret(enc)).toBe(true)
    expect(decryptSecret(enc)).toBe(secret)
  })

  it('produces a unique ciphertext each time (unique nonce)', () => {
    const a = encryptSecret('same-value')
    const b = encryptSecret('same-value')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('same-value')
    expect(decryptSecret(b)).toBe('same-value')
  })

  it('handles empty string as a distinct valid value', () => {
    const enc = encryptSecret('')
    expect(decryptSecret(enc)).toBe('')
  })
})

describe('secret-cipher — legacy plaintext passthrough (migration)', () => {
  it('returns an unmarked (legacy plaintext) value unchanged', () => {
    expect(decryptSecret('legacy-plaintext-pass')).toBe('legacy-plaintext-pass')
    expect(isEncryptedSecret('legacy-plaintext-pass')).toBe(false)
  })
  it('passes through null/undefined', () => {
    expect(decryptSecret(null)).toBeNull()
    expect(decryptSecret(undefined)).toBeNull()
  })
})

describe('secret-cipher — tamper detection & wrong key', () => {
  it('throws when the ciphertext is tampered', () => {
    const enc = encryptSecret('secret')
    // Flip a byte inside the base64 payload.
    const payload = enc.slice(PREFIX.length)
    const buf = Buffer.from(payload, 'base64')
    const env = JSON.parse(buf.toString('utf8'))
    const ctBuf = Buffer.from(env.ct, 'base64')
    ctBuf[0] ^= 0xff
    env.ct = ctBuf.toString('base64')
    const tampered = PREFIX + Buffer.from(JSON.stringify(env), 'utf8').toString('base64')
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('throws (does not silently return plaintext) when no matching key exists', () => {
    const enc = encryptSecret('secret') // encrypted under KEY_A
    setEnv('GF_SMTP_CIPHER_KEY', KEY_B) // now only KEY_B present
    setEnv('GF_SMTP_CIPHER_KEY_OLD', undefined)
    expect(() => decryptSecret(enc)).toThrow()
  })

  it('throws on encrypt when the key is missing (never stores plaintext)', () => {
    setEnv('GF_SMTP_CIPHER_KEY', undefined)
    expect(secretCipherConfigured()).toBe(false)
    expect(() => encryptSecret('secret')).toThrow(/GF_SMTP_CIPHER_KEY/)
  })

  it('rejects a weak/generic key', () => {
    setEnv('GF_SMTP_CIPHER_KEY', 'changeme')
    expect(secretCipherConfigured()).toBe(false)
    expect(() => encryptSecret('secret')).toThrow()
  })
})

describe('secret-cipher — key rotation', () => {
  it('decrypts an old-key value while the new key is primary', () => {
    // Encrypt under KEY_A.
    const enc = encryptSecret('rotate-me')
    // Rotate: KEY_B becomes primary, KEY_A moves to OLD.
    setEnv('GF_SMTP_CIPHER_KEY', KEY_B)
    setEnv('GF_SMTP_CIPHER_KEY_OLD', KEY_A)
    // Old ciphertext still decrypts via the OLD key (kid match).
    expect(decryptSecret(enc)).toBe('rotate-me')
    // New encryptions use the new primary and still round-trip.
    const enc2 = encryptSecret('rotate-me')
    expect(decryptSecret(enc2)).toBe('rotate-me')
  })

  it('supports multiple comma-separated old keys', () => {
    const enc = encryptSecret('multi') // KEY_A
    const KEY_C = crypto.randomBytes(32).toString('base64')
    setEnv('GF_SMTP_CIPHER_KEY', KEY_C)
    setEnv('GF_SMTP_CIPHER_KEY_OLD', `${KEY_B}, ${KEY_A}`)
    expect(decryptSecret(enc)).toBe('multi')
  })
})
