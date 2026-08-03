import { describe, it, expect, afterEach, vi } from 'vitest'
import { validateEnv, assertEnv } from '@/lib/env'

const OLD = { ...process.env }
afterEach(() => {
  process.env = { ...OLD }
  vi.unstubAllEnvs()
})

describe('env — validation & fail-fast', () => {
  it('signale NEXTAUTH_SECRET faible et DATABASE_URL absente', () => {
    delete process.env.DATABASE_URL
    process.env.NEXTAUTH_SECRET = 'weak'
    const { ok, issues } = validateEnv()
    expect(ok).toBe(false)
    expect(issues.map((i) => i.name)).toContain('NEXTAUTH_SECRET')
    expect(issues.map((i) => i.name)).toContain('DATABASE_URL')
  })

  it('valide une configuration correcte', () => {
    process.env.DATABASE_URL = 'file:./dev.db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    expect(validateEnv().ok).toBe(true)
  })

  it('assertEnv LÈVE en production si invalide', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.DATABASE_URL
    process.env.NEXTAUTH_SECRET = 'weak'
    expect(() => assertEnv()).toThrow(/Démarrage refusé/)
  })

  it('assertEnv NE lève PAS en développement (avertit seulement)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    delete process.env.DATABASE_URL
    process.env.NEXTAUTH_SECRET = 'weak'
    expect(() => assertEnv()).not.toThrow()
  })

  it("assertEnv ne lève jamais quand la config est valide, même en production", () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    process.env.TRUST_PROXY_HEADERS = '1'
    expect(() => assertEnv()).not.toThrow()
  })
})

describe('env — garde-fou PWA production (PostgreSQL obligatoire)', () => {
  it('PWA production + SQLite (file:) = erreur bloquante', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = 'file:./prod.db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    const { ok, issues } = validateEnv()
    expect(ok).toBe(false)
    expect(issues.some(i => i.name === 'DATABASE_URL' && /SQLite/.test(i.problem))).toBe(true)
    expect(() => assertEnv()).toThrow(/Démarrage refusé/)
  })

  it('PWA production + PostgreSQL + pepper + Upstash + proxy de confiance = accepté', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    process.env.TRUST_PROXY_HEADERS = '1'
    expect(validateEnv().ok).toBe(true)
  })

  it('PWA production sans signal de proxy de confiance (VERCEL/TRUST_PROXY_HEADERS) = refusé', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    delete process.env.VERCEL
    delete process.env.TRUST_PROXY_HEADERS
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    const { ok, issues } = validateEnv()
    expect(ok).toBe(false)
    expect(issues.some((i) => i.name === 'TRUST_PROXY_HEADERS')).toBe(true)
  })

  it('PWA production avec VERCEL=1 (proxy géré Vercel) = accepté sans TRUST_PROXY_HEADERS', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    delete process.env.TRUST_PROXY_HEADERS
    process.env.VERCEL = '1'
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    expect(validateEnv().ok).toBe(true)
  })

  it('Electron production + SQLite = autorisé (ELECTRON=1), sans pepper ni Upstash', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.ELECTRON = '1'
    process.env.DATABASE_URL = 'file:./garageflow.db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    delete process.env.DEVICE_TOKEN_PEPPER
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    expect(validateEnv().ok).toBe(true)
  })

  it('PWA production sans DEVICE_TOKEN_PEPPER = démarrage refusé', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    delete process.env.DEVICE_TOKEN_PEPPER
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    const { ok, issues } = validateEnv()
    expect(ok).toBe(false)
    expect(issues.some((i) => i.name === 'DEVICE_TOKEN_PEPPER')).toBe(true)
    expect(() => assertEnv()).toThrow(/Démarrage refusé/)
  })

  it('PWA production avec pepper générique (« changeme ») = refusé', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'changeme'
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    expect(validateEnv().ok).toBe(false)
  })

  it('PWA production + URL Upstash rediss:// (non REST) = refusé', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.VERCEL = '1'
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
    process.env.UPSTASH_REDIS_REST_URL = 'rediss://default:token@host:6379'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    const { ok, issues } = validateEnv()
    expect(ok).toBe(false)
    expect(issues.some((i) => i.name === 'UPSTASH_REDIS_REST_URL')).toBe(true)
  })

  it('PWA production sans Upstash = démarrage refusé (rate limiting distribué requis)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    const { ok, issues } = validateEnv()
    expect(ok).toBe(false)
    expect(issues.some((i) => /UPSTASH/.test(i.name))).toBe(true)
  })
})
