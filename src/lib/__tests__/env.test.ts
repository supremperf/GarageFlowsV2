/**
 * Tests for the centralized environment/secret validator (src/lib/env.ts).
 *
 * env.ts reads process.env lazily (inside each function), so tests set the
 * relevant variables per case and restore the original environment afterwards.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isStrongSecret,
  authSecret,
  authSecretKeys,
  portalVerifyKeys,
  smtpConfig,
  stripeConfig,
  validateCriticalEnv,
  assertStartupEnv,
  EnvError,
  MIN_SECRET_LENGTH,
} from '../env'

const STRONG = 'unit-test-strong-secret-abcdef0123456789'  // 40 chars, not a known default
const STRONG_2 = 'second-strong-secret-value-0123456789abcd'
const decode = (u: Uint8Array): string => new TextDecoder().decode(u)

// Variables this suite manipulates — cleared before each test, restored at the end.
const MANAGED = [
  'NEXTAUTH_SECRET', 'NEXTAUTH_SECRET_PREVIOUS',
  'GF_PORTAL_SECRET', 'GF_PORTAL_SECRET_PREVIOUS', 'GF_DB_MAC_SECRET',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
] as const

const original: Record<string, string | undefined> = {}
for (const k of MANAGED) original[k] = process.env[k]

beforeEach(() => {
  for (const k of MANAGED) delete process.env[k]
})
afterEach(() => {
  for (const k of MANAGED) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})

describe('isStrongSecret', () => {
  it('rejects empty / undefined', () => {
    expect(isStrongSecret(undefined)).toBe(false)
    expect(isStrongSecret('')).toBe(false)
  })
  it(`rejects values shorter than ${MIN_SECRET_LENGTH} chars`, () => {
    expect(isStrongSecret('short')).toBe(false)
  })
  it('rejects known default / placeholder / committed values', () => {
    for (const weak of [
      'gf-electron-local-secret-2026-xK9mP3qR',
      'fallback-dev-secret-change-in-production',
      'CHANGE_ME_run_openssl_rand_base64_32',
      '3jvKZFYUKLjGTI/mneyeY0fUN/FNp9d1XzOgnOij7+I=',
      'changeme',
    ]) {
      expect(isStrongSecret(weak)).toBe(false)
    }
  })
  it('accepts a strong unique value', () => {
    expect(isStrongSecret(STRONG)).toBe(true)
  })
})

describe('authSecret', () => {
  it('throws EnvError when NEXTAUTH_SECRET is missing', () => {
    expect(() => authSecret()).toThrow(EnvError)
  })
  it('throws when the value is a known default', () => {
    process.env.NEXTAUTH_SECRET = 'gf-electron-local-secret-2026-xK9mP3qR'
    expect(() => authSecret()).toThrow(/known default|placeholder|compromised/i)
  })
  it('throws when the value is too short', () => {
    process.env.NEXTAUTH_SECRET = 'tooshort'
    expect(() => authSecret()).toThrow(/too short/i)
  })
  it('returns the trimmed value when strong', () => {
    process.env.NEXTAUTH_SECRET = `  ${STRONG}  `
    expect(authSecret()).toBe(STRONG)
  })
})

describe('authSecretKeys — rotation', () => {
  it('returns a single key when no previous secret is set', () => {
    process.env.NEXTAUTH_SECRET = STRONG
    const keys = authSecretKeys()
    expect(keys).toHaveLength(1)
    expect(decode(keys[0])).toBe(STRONG)
  })
  it('appends previous secrets (current first) and drops weak/blank entries', () => {
    process.env.NEXTAUTH_SECRET = STRONG
    process.env.NEXTAUTH_SECRET_PREVIOUS = `${STRONG_2}, , short, changeme`
    const keys = authSecretKeys().map(decode)
    expect(keys[0]).toBe(STRONG)          // current signs
    expect(keys).toContain(STRONG_2)      // valid previous kept
    expect(keys).not.toContain('short')   // weak dropped
    expect(keys).not.toContain('changeme')
    expect(keys).toHaveLength(2)
  })
  it('de-duplicates when a previous secret equals the current one', () => {
    process.env.NEXTAUTH_SECRET = STRONG
    process.env.NEXTAUTH_SECRET_PREVIOUS = STRONG
    expect(authSecretKeys()).toHaveLength(1)
  })
})

describe('portalVerifyKeys', () => {
  it('equals the auth keys when no dedicated portal secret is set', () => {
    process.env.NEXTAUTH_SECRET = STRONG
    expect(portalVerifyKeys().map(decode)).toEqual([STRONG])
  })
  it('accepts the dedicated portal secret first, then the auth keys', () => {
    process.env.NEXTAUTH_SECRET = STRONG
    process.env.GF_PORTAL_SECRET = STRONG_2
    const keys = portalVerifyKeys().map(decode)
    expect(keys[0]).toBe(STRONG_2)
    expect(keys).toContain(STRONG)   // backward-compat with tokens signed before the portal secret existed
  })
})

describe('smtpConfig', () => {
  it('returns null when nothing is configured', () => {
    expect(smtpConfig()).toBeNull()
  })
  it('throws when partially configured (host without credentials)', () => {
    process.env.SMTP_HOST = 'smtp.example.com'
    expect(() => smtpConfig()).toThrow(EnvError)
  })
  it('returns a full config and marks port 465 as secure', () => {
    process.env.SMTP_HOST = 'smtp.example.com'
    process.env.SMTP_PORT = '465'
    process.env.SMTP_USER = 'user@example.com'
    process.env.SMTP_PASS = 'a-real-smtp-password'
    const cfg = smtpConfig()
    expect(cfg).not.toBeNull()
    expect(cfg?.port).toBe(465)
    expect(cfg?.secure).toBe(true)
    expect(cfg?.from).toBe('user@example.com')   // defaults to user
  })
  it('rejects an invalid port', () => {
    process.env.SMTP_HOST = 'smtp.example.com'
    process.env.SMTP_PORT = 'not-a-port'
    process.env.SMTP_USER = 'user@example.com'
    process.env.SMTP_PASS = 'a-real-smtp-password'
    expect(() => smtpConfig()).toThrow(/port/i)
  })
})

describe('stripeConfig', () => {
  it('returns null when not configured', () => {
    expect(stripeConfig()).toBeNull()
  })
  it('throws on a malformed secret key', () => {
    process.env.STRIPE_SECRET_KEY = 'not-a-stripe-key-but-long-enough'
    expect(() => stripeConfig()).toThrow(EnvError)
  })
  it('accepts a well-formed key and validates the webhook secret', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_0123456789abcdefghij'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_0123456789abcdef'
    const cfg = stripeConfig()
    expect(cfg?.secretKey).toContain('sk_test_')
    expect(cfg?.webhookSecret).toContain('whsec_')
  })
  it('throws on a malformed webhook secret', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_0123456789abcdefghij'
    process.env.STRIPE_WEBHOOK_SECRET = 'not-a-webhook-secret'
    expect(() => stripeConfig()).toThrow(/webhook/i)
  })
})

describe('validateCriticalEnv', () => {
  it('reports a blocking error when NEXTAUTH_SECRET is missing', () => {
    const { ok, issues } = validateCriticalEnv({ requireDbMac: false })
    expect(ok).toBe(false)
    expect(issues.some(i => i.variable === 'NEXTAUTH_SECRET' && i.level === 'error')).toBe(true)
  })
  it('passes when the mandatory secret is strong and no features are configured', () => {
    process.env.NEXTAUTH_SECRET = STRONG
    const { ok } = validateCriticalEnv({ requireDbMac: false })
    expect(ok).toBe(true)
  })
  it('requires GF_DB_MAC_SECRET when requireDbMac is true', () => {
    process.env.NEXTAUTH_SECRET = STRONG
    const { ok, issues } = validateCriticalEnv({ requireDbMac: true })
    expect(ok).toBe(false)
    expect(issues.some(i => i.variable === 'GF_DB_MAC_SECRET' && i.level === 'error')).toBe(true)
  })
})

describe('assertStartupEnv', () => {
  it('throws when a mandatory secret is missing', () => {
    expect(() => assertStartupEnv()).toThrow(EnvError)
  })
  it('does not throw when the mandatory secret is strong', () => {
    process.env.NEXTAUTH_SECRET = STRONG
    expect(() => assertStartupEnv()).not.toThrow()
  })
})
