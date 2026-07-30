import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { getSessionSecretString } from '../session-secret'
import { portalSecret } from '../portal-secret'

/**
 * Regression tests for the fail-closed session/portal secret resolution.
 *
 * The vulnerability these guard against: shipping a hardcoded fallback secret so
 * that a misconfigured production server (no NEXTAUTH_SECRET) would sign/verify
 * admin `gf_session` (and portal) JWTs with a publicly-known constant — allowing
 * anyone to forge an admin session or portal token.
 */

const OLD_ENV = { ...process.env }

beforeEach(() => {
  // Work from a clean slate each time
  delete process.env.NEXTAUTH_SECRET
  delete process.env.GF_PORTAL_SECRET
})

afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('getSessionSecretString', () => {
  it('returns the configured NEXTAUTH_SECRET when set (any environment)', () => {
    process.env.NODE_ENV = 'production'
    process.env.NEXTAUTH_SECRET = 'a-strong-random-production-secret'
    expect(getSessionSecretString()).toBe('a-strong-random-production-secret')
  })

  it('THROWS in production when NEXTAUTH_SECRET is missing (fail-closed)', () => {
    process.env.NODE_ENV = 'production'
    expect(() => getSessionSecretString()).toThrow(/NEXTAUTH_SECRET/)
  })

  it('falls back to a dev-only value outside production so local dev still works', () => {
    process.env.NODE_ENV = 'development'
    expect(() => getSessionSecretString()).not.toThrow()
    expect(getSessionSecretString().length).toBeGreaterThan(0)
  })

  it('never returns an empty secret', () => {
    process.env.NODE_ENV = 'development'
    expect(getSessionSecretString()).not.toBe('')
  })
})

describe('portalSecret', () => {
  it('prefers GF_PORTAL_SECRET, then NEXTAUTH_SECRET', () => {
    process.env.NODE_ENV = 'production'
    process.env.NEXTAUTH_SECRET = 'nextauth-value'
    // Only NEXTAUTH_SECRET set → used
    const a = new TextDecoder().decode(portalSecret())
    expect(a).toBe('nextauth-value')

    process.env.GF_PORTAL_SECRET = 'portal-value'
    const b = new TextDecoder().decode(portalSecret())
    expect(b).toBe('portal-value')
  })

  it('THROWS in production when no secret is configured (fail-closed)', () => {
    process.env.NODE_ENV = 'production'
    expect(() => portalSecret()).toThrow()
  })

  it('does not throw outside production', () => {
    process.env.NODE_ENV = 'test'
    expect(() => portalSecret()).not.toThrow()
  })
})
