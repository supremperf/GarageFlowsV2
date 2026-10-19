/**
 * Phase 1 — Encrypted backup cryptography (AES-256-GCM).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Authenticated encryption for GarageFlow backups. AES-256-GCM provides both
 * confidentiality and integrity: any modification of the ciphertext, IV or tag
 * makes {@link decrypt} throw, so a tampered backup can never be silently
 * restored. Keys are either a raw 32-byte key (from `GF_BACKUP_KEY`) or derived
 * from a passphrase via scrypt. Pure Node crypto — deterministic and testable.
 */

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const SALT_BYTES = 16
const KEY_BYTES = 32
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const

/** Self-describing, versioned encrypted container (JSON-serialisable). */
export interface EncryptedEnvelope {
  v: 1
  alg: 'aes-256-gcm'
  kdf: 'raw' | 'scrypt'
  /** base64 scrypt salt (present only when kdf = 'scrypt'). */
  salt?: string
  iv: string
  tag: string
  ct: string
}

/** Encrypt with a raw 32-byte key. */
export function encrypt(plaintext: Buffer | string, key: Buffer): EncryptedEnvelope {
  if (key.length !== KEY_BYTES) throw new Error(`key must be ${KEY_BYTES} bytes`)
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ct = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    v: 1,
    alg: 'aes-256-gcm',
    kdf: 'raw',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  }
}

/** Decrypt with a raw 32-byte key. Throws if the key is wrong or data tampered. */
export function decrypt(env: EncryptedEnvelope, key: Buffer): Buffer {
  if (key.length !== KEY_BYTES) throw new Error(`key must be ${KEY_BYTES} bytes`)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(env.iv, 'base64'), { authTagLength: 16 })
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(env.ct, 'base64')), decipher.final()])
}

/** Derive a 32-byte key from a passphrase via scrypt. */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, KEY_BYTES, SCRYPT_PARAMS)
}

/** Encrypt with a passphrase (a fresh scrypt salt is embedded in the envelope). */
export function encryptWithPassphrase(plaintext: Buffer | string, passphrase: string): EncryptedEnvelope {
  const salt = crypto.randomBytes(SALT_BYTES)
  const env = encrypt(plaintext, deriveKey(passphrase, salt))
  return { ...env, kdf: 'scrypt', salt: salt.toString('base64') }
}

/** Decrypt a passphrase-encrypted envelope. */
export function decryptWithPassphrase(env: EncryptedEnvelope, passphrase: string): Buffer {
  if (!env.salt) throw new Error('envelope has no scrypt salt')
  return decrypt(env, deriveKey(passphrase, Buffer.from(env.salt, 'base64')))
}

/** SHA-256 hex checksum — stored with the backup for restore verification. */
export function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data).digest('hex')
}

/** Parse a base64 raw key and validate its length. */
export function parseRawKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64')
  if (key.length !== KEY_BYTES) throw new Error(`GF_BACKUP_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`)
  return key
}
