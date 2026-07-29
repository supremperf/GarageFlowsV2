import { describe, it, expect, afterEach } from 'vitest'
import { validateServerEnv } from '@/lib/env'

const KEYS = ['NEXTAUTH_SECRET', 'DATABASE_URL'] as const
const ORIGINAL: Record<string, string | undefined> = {}
for (const k of KEYS) ORIGINAL[k] = process.env[k]

afterEach(() => {
  for (const k of KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k]
    else process.env[k] = ORIGINAL[k]
  }
})

describe('validateServerEnv', () => {
  it('valide une configuration correcte', () => {
    process.env.NEXTAUTH_SECRET = 'a'.repeat(32)
    process.env.DATABASE_URL = 'file:./dev.db'
    const { ok, issues } = validateServerEnv()
    expect(ok).toBe(true)
    expect(issues).toHaveLength(0)
  })

  it('détecte un NEXTAUTH_SECRET absent', () => {
    delete process.env.NEXTAUTH_SECRET
    process.env.DATABASE_URL = 'file:./dev.db'
    const { ok, issues } = validateServerEnv()
    expect(ok).toBe(false)
    expect(issues.some((i) => i.name === 'NEXTAUTH_SECRET')).toBe(true)
  })

  it('détecte une valeur d’exemple (CHANGE_ME)', () => {
    process.env.NEXTAUTH_SECRET = 'CHANGE_ME_WITH_A_SECURE_RANDOM_VALUE'
    process.env.DATABASE_URL = 'file:./dev.db'
    const { ok, issues } = validateServerEnv()
    expect(ok).toBe(false)
    expect(issues.some((i) => i.problem.includes('exemple'))).toBe(true)
  })

  it('détecte un DATABASE_URL absent', () => {
    process.env.NEXTAUTH_SECRET = 'a'.repeat(32)
    delete process.env.DATABASE_URL
    const { ok, issues } = validateServerEnv()
    expect(ok).toBe(false)
    expect(issues.some((i) => i.name === 'DATABASE_URL')).toBe(true)
  })
})
