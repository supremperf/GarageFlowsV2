/**
 * Tests for the portal 2FA / auth crypto core: TOTP (against RFC 6238 vectors),
 * backup codes and the lockout state machine.
 */
import { describe, it, expect } from 'vitest'
import {
  base32Encode, base32Decode, generateTotp, verifyTotp, generateTotpSecret, otpauthURL,
} from '../totp'
import { generateBackupCodes, verifyBackupCode, hashBackupCode, normalizeCode } from '../backup-codes'
import {
  registerFailure, registerSuccess, isLocked, lockRemainingSec, DEFAULT_LOCKOUT_POLICY,
} from '../lockout'

// RFC 6238 shared secret (ASCII "12345678901234567890").
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'))

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    const buf = Buffer.from('Hello, GarageFlows 2FA!')
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true)
  })
  it('is tolerant of lower-case and spacing on decode', () => {
    const enc = base32Encode(Buffer.from('abc'))
    expect(base32Decode(enc.toLowerCase()).toString()).toBe('abc')
  })
})

describe('TOTP — RFC 6238 test vectors (SHA-1, 8 digits)', () => {
  const cases: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ]
  for (const [t, expected] of cases) {
    it(`T=${t} → ${expected}`, () => {
      expect(generateTotp(RFC_SECRET, t * 1000, { digits: 8 })).toBe(expected)
    })
  }
  it('matches the 6-digit truncation', () => {
    expect(generateTotp(RFC_SECRET, 59 * 1000, { digits: 6 })).toBe('287082')
  })
})

describe('verifyTotp', () => {
  it('accepts the current token', () => {
    const now = 59 * 1000
    expect(verifyTotp('287082', RFC_SECRET, { atMs: now })).toBe(true)
  })
  it('accepts a token within the drift window and rejects outside it', () => {
    const now = 1111111111 * 1000
    const prev = generateTotp(RFC_SECRET, now - 30 * 1000) // one step earlier
    expect(verifyTotp(prev, RFC_SECRET, { atMs: now, window: 1 })).toBe(true)
    const older = generateTotp(RFC_SECRET, now - 120 * 1000) // 4 steps earlier
    expect(verifyTotp(older, RFC_SECRET, { atMs: now, window: 1 })).toBe(false)
  })
  it('rejects malformed tokens', () => {
    expect(verifyTotp('', RFC_SECRET)).toBe(false)
    expect(verifyTotp('abcdef', RFC_SECRET)).toBe(false)
    expect(verifyTotp('12345', RFC_SECRET)).toBe(false) // wrong length
  })
  it('generateTotpSecret produces a verifiable secret', () => {
    const secret = generateTotpSecret()
    const token = generateTotp(secret)
    expect(verifyTotp(token, secret)).toBe(true)
  })
  it('otpauthURL contains the secret, issuer and algorithm', () => {
    const url = otpauthURL({ secret: RFC_SECRET, label: 'client@example.com', issuer: 'GarageFlows' })
    expect(url).toContain('otpauth://totp/')
    expect(url).toContain(`secret=${RFC_SECRET}`)
    expect(url).toContain('issuer=GarageFlows')
    expect(url).toContain('algorithm=SHA1')
  })
})

describe('backup codes', () => {
  it('generates formatted codes with matching hashes', () => {
    const { codes, hashes } = generateBackupCodes(10)
    expect(codes).toHaveLength(10)
    expect(hashes).toHaveLength(10)
    expect(codes[0]).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(hashes[0]).toBe(hashBackupCode(codes[0]))
  })
  it('verifies a code regardless of case/spacing and returns its index', () => {
    const { codes, hashes } = generateBackupCodes(5)
    const idx = 2
    const messy = `  ${codes[idx].toLowerCase().replace('-', ' ')} `
    expect(verifyBackupCode(messy, hashes)).toBe(idx)
  })
  it('rejects an unknown code', () => {
    const { hashes } = generateBackupCodes(5)
    expect(verifyBackupCode('ZZZZ-ZZZZ', hashes)).toBe(-1)
  })
  it('normalizeCode strips separators and upper-cases', () => {
    expect(normalizeCode(' ab-cd ')).toBe('ABCD')
  })
})

describe('lockout state machine', () => {
  const t0 = 1_000_000
  it('locks after maxAttempts consecutive failures', () => {
    let state = { failedCount: 0, lockedUntil: null as number | null }
    for (let i = 0; i < DEFAULT_LOCKOUT_POLICY.maxAttempts - 1; i++) {
      state = registerFailure(state, DEFAULT_LOCKOUT_POLICY, t0)
      expect(isLocked(state, t0)).toBe(false)
    }
    state = registerFailure(state, DEFAULT_LOCKOUT_POLICY, t0)
    expect(isLocked(state, t0)).toBe(true)
    expect(lockRemainingSec(state, t0)).toBe(DEFAULT_LOCKOUT_POLICY.lockoutMs / 1000)
  })
  it('unlocks after the lockout window elapses', () => {
    let state = { failedCount: 4, lockedUntil: null as number | null }
    state = registerFailure(state, DEFAULT_LOCKOUT_POLICY, t0) // 5th → locked
    const afterExpiry = t0 + DEFAULT_LOCKOUT_POLICY.lockoutMs + 1
    expect(isLocked(state, afterExpiry)).toBe(false)
    // A failure after expiry starts a fresh window (count = 1, not locked).
    const next = registerFailure(state, DEFAULT_LOCKOUT_POLICY, afterExpiry)
    expect(next.failedCount).toBe(1)
    expect(isLocked(next, afterExpiry)).toBe(false)
  })
  it('registerSuccess resets the state', () => {
    expect(registerSuccess()).toEqual({ failedCount: 0, lockedUntil: null })
  })
})
