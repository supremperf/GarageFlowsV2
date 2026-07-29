/**
 * Tests for the AES-256-GCM backup cryptography (src/lib/backup/crypto.ts).
 * Covers round-trip, wrong-key rejection, tamper detection and passphrase KDF.
 */
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import {
  encrypt, decrypt, deriveKey, encryptWithPassphrase, decryptWithPassphrase, sha256, parseRawKey,
} from '../crypto'

const KEY = crypto.randomBytes(32)
const PLAINTEXT = JSON.stringify({ clients: [{ id: 'c1', name: 'Test' }], jobs: [] })

describe('encrypt / decrypt (raw key)', () => {
  it('round-trips the plaintext', () => {
    const env = encrypt(PLAINTEXT, KEY)
    expect(env.alg).toBe('aes-256-gcm')
    expect(decrypt(env, KEY).toString('utf8')).toBe(PLAINTEXT)
  })

  it('rejects a key of the wrong size', () => {
    expect(() => encrypt(PLAINTEXT, crypto.randomBytes(16))).toThrow(/32 bytes/)
  })

  it('fails to decrypt with the wrong key', () => {
    const env = encrypt(PLAINTEXT, KEY)
    expect(() => decrypt(env, crypto.randomBytes(32))).toThrow()
  })

  it('detects tampered ciphertext (GCM auth tag)', () => {
    const env = encrypt(PLAINTEXT, KEY)
    const ct = Buffer.from(env.ct, 'base64')
    ct[0] ^= 0xff
    expect(() => decrypt({ ...env, ct: ct.toString('base64') }, KEY)).toThrow()
  })

  it('detects a tampered auth tag', () => {
    const env = encrypt(PLAINTEXT, KEY)
    const tag = Buffer.from(env.tag, 'base64')
    tag[0] ^= 0xff
    expect(() => decrypt({ ...env, tag: tag.toString('base64') }, KEY)).toThrow()
  })
})

describe('passphrase (scrypt) encryption', () => {
  it('round-trips with the correct passphrase', () => {
    const env = encryptWithPassphrase(PLAINTEXT, 'correct horse battery staple')
    expect(env.kdf).toBe('scrypt')
    expect(env.salt).toBeTruthy()
    expect(decryptWithPassphrase(env, 'correct horse battery staple').toString('utf8')).toBe(PLAINTEXT)
  })

  it('fails with the wrong passphrase', () => {
    const env = encryptWithPassphrase(PLAINTEXT, 'passphrase-A')
    expect(() => decryptWithPassphrase(env, 'passphrase-B')).toThrow()
  })

  it('deriveKey is deterministic for a given salt', () => {
    const salt = crypto.randomBytes(16)
    expect(deriveKey('pw', salt).equals(deriveKey('pw', salt))).toBe(true)
  })
})

describe('sha256 / parseRawKey', () => {
  it('sha256 is a stable 64-char hex digest', () => {
    expect(sha256(PLAINTEXT)).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256(PLAINTEXT)).toBe(sha256(PLAINTEXT))
  })
  it('parseRawKey validates the decoded length', () => {
    expect(parseRawKey(crypto.randomBytes(32).toString('base64')).length).toBe(32)
    expect(() => parseRawKey(crypto.randomBytes(16).toString('base64'))).toThrow(/32 bytes/)
  })
})
