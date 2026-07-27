/**
 * Tests for the shared, rotation-aware gf_session JWT helper (src/lib/session-jwt.ts).
 * Proves the security guarantees: signed tokens round-trip, forged/tampered tokens
 * are rejected, and a NEXTAUTH_SECRET rotation keeps existing sessions valid only
 * while the old key remains in NEXTAUTH_SECRET_PREVIOUS.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { signSessionJwt, verifySessionJwt } from '../session-jwt'

const CURRENT = 'session-current-secret-abcdef0123456789'
const OLD = 'session-previous-secret-abcdef0123456789'

const original = {
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  NEXTAUTH_SECRET_PREVIOUS: process.env.NEXTAUTH_SECRET_PREVIOUS,
}

beforeEach(() => {
  delete process.env.NEXTAUTH_SECRET
  delete process.env.NEXTAUTH_SECRET_PREVIOUS
})
afterEach(() => {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('signSessionJwt / verifySessionJwt', () => {
  it('round-trips claims signed and verified with the same secret', async () => {
    process.env.NEXTAUTH_SECRET = CURRENT
    const token = await signSessionJwt({ typ: 'admin', lid: 'lic-123' })
    const claims = await verifySessionJwt(token)
    expect(claims).toEqual({ typ: 'admin', lid: 'lic-123' })
  })

  it('returns null for a missing token', async () => {
    process.env.NEXTAUTH_SECRET = CURRENT
    expect(await verifySessionJwt(undefined)).toBeNull()
    expect(await verifySessionJwt('')).toBeNull()
  })

  it('rejects a tampered / garbage token', async () => {
    process.env.NEXTAUTH_SECRET = CURRENT
    expect(await verifySessionJwt('not.a.jwt')).toBeNull()
  })

  it('rejects a token signed with a completely different secret', async () => {
    process.env.NEXTAUTH_SECRET = OLD
    const forged = await signSessionJwt({ typ: 'admin', lid: 'lic-123' })
    // Rotate to a new secret with NO grace window — the old token must now fail.
    process.env.NEXTAUTH_SECRET = CURRENT
    expect(await verifySessionJwt(forged)).toBeNull()
  })

  it('keeps a pre-rotation token valid while the old key is in NEXTAUTH_SECRET_PREVIOUS', async () => {
    // 1. Token issued under the old secret.
    process.env.NEXTAUTH_SECRET = OLD
    const token = await signSessionJwt({ typ: 'premium', lid: 'lic-9' })

    // 2. Rotate: new current secret, old one kept in the grace window.
    process.env.NEXTAUTH_SECRET = CURRENT
    process.env.NEXTAUTH_SECRET_PREVIOUS = OLD
    expect(await verifySessionJwt(token)).toEqual({ typ: 'premium', lid: 'lic-9' })

    // 3. Grace window closed — old token no longer accepted.
    delete process.env.NEXTAUTH_SECRET_PREVIOUS
    expect(await verifySessionJwt(token)).toBeNull()
  })

  it('always signs with the current key (not a previous one)', async () => {
    process.env.NEXTAUTH_SECRET = CURRENT
    process.env.NEXTAUTH_SECRET_PREVIOUS = OLD
    const token = await signSessionJwt({ typ: 'admin', lid: 'x' })
    // Drop the previous key; a token signed with CURRENT must still verify.
    delete process.env.NEXTAUTH_SECRET_PREVIOUS
    expect(await verifySessionJwt(token)).toEqual({ typ: 'admin', lid: 'x' })
  })
})
