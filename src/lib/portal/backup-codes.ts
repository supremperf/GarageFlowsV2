/**
 * One-time recovery (backup) codes for portal two-factor authentication.
 *
 * Codes are shown to the user once and stored only as SHA-256 hashes. Each code
 * is single-use: on a successful match the caller removes that hash from the set.
 * Pure Node crypto — deterministic hashing, timing-safe comparison.
 */

import crypto from 'crypto'

// Unambiguous alphabet (no 0/O/1/I) for readable, dictated codes.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const GROUP = 4
const GROUPS = 2 // → 8 chars, formatted "XXXX-XXXX"

/** Normalise a user-entered code: strip separators/spaces, upper-case. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** SHA-256 hex hash of a normalised backup code (storage form). */
export function hashBackupCode(code: string): string {
  return crypto.createHash('sha256').update(normalizeCode(code), 'utf8').digest('hex')
}

function randomCode(): string {
  const chars: string[] = []
  const bytes = crypto.randomBytes(GROUP * GROUPS)
  for (let i = 0; i < GROUP * GROUPS; i++) chars.push(ALPHABET[bytes[i] % ALPHABET.length])
  const parts: string[] = []
  for (let i = 0; i < GROUPS; i++) parts.push(chars.slice(i * GROUP, i * GROUP + GROUP).join(''))
  return parts.join('-')
}

/**
 * Generate `count` backup codes. Returns the plaintext codes (to show once) and
 * their hashes (to persist). The plaintext is never stored.
 */
export function generateBackupCodes(count = 10): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: count }, randomCode)
  return { codes, hashes: codes.map(hashBackupCode) }
}

/**
 * Verify a submitted code against the stored hashes (timing-safe). Returns the
 * index of the matched hash, or -1. The caller must remove `hashes[index]` so the
 * code cannot be reused.
 */
export function verifyBackupCode(code: string, hashes: string[]): number {
  const candidate = Buffer.from(hashBackupCode(code), 'hex')
  let matched = -1
  // Scan all entries (no early return) to avoid leaking position via timing.
  for (let i = 0; i < hashes.length; i++) {
    let stored: Buffer
    try {
      stored = Buffer.from(hashes[i], 'hex')
    } catch {
      continue
    }
    if (stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate)) matched = i
  }
  return matched
}
