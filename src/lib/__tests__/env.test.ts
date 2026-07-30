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
    expect(() => assertEnv()).not.toThrow()
  })
})
