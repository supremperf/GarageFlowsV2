import { describe, it, expect, afterEach } from 'vitest'
import { isWeakSecret, getAuthSecret, getPortalSecret } from '@/lib/auth-secret'

const OLD = process.env.NEXTAUTH_SECRET
const OLD_PORTAL = process.env.GF_PORTAL_SECRET
afterEach(() => {
  process.env.NEXTAUTH_SECRET = OLD
  if (OLD_PORTAL === undefined) delete process.env.GF_PORTAL_SECRET
  else process.env.GF_PORTAL_SECRET = OLD_PORTAL
})

describe('auth-secret — aucun repli codé en dur', () => {
  it('isWeakSecret détecte absent/court/générique/anciens replis', () => {
    expect(isWeakSecret(undefined)).toBe(true)
    expect(isWeakSecret('')).toBe(true)
    expect(isWeakSecret('short')).toBe(true)
    expect(isWeakSecret('gf-electron-local-secret-2026-xK9mP3qR')).toBe(true)
    expect(isWeakSecret('fallback-dev-secret-change-in-production')).toBe(true)
    expect(isWeakSecret('fallback-portal-secret-change-in-production')).toBe(true)
    expect(isWeakSecret('a'.repeat(40))).toBe(false)
  })

  it('getAuthSecret LÈVE si le secret est absent', () => {
    delete process.env.NEXTAUTH_SECRET
    expect(() => getAuthSecret()).toThrow(/NEXTAUTH_SECRET/)
  })

  it('getAuthSecret LÈVE si le secret est un ancien repli en dur', () => {
    process.env.NEXTAUTH_SECRET = 'gf-electron-local-secret-2026-xK9mP3qR'
    expect(() => getAuthSecret()).toThrow()
  })

  it('getAuthSecret accepte un secret fort', () => {
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    expect(getAuthSecret()).toBe('x'.repeat(40))
  })

  it('getPortalSecret préfère GF_PORTAL_SECRET fort, sinon NEXTAUTH_SECRET', () => {
    process.env.NEXTAUTH_SECRET = 'n'.repeat(40)
    process.env.GF_PORTAL_SECRET = 'p'.repeat(40)
    expect(getPortalSecret()).toBe('p'.repeat(40))
    process.env.GF_PORTAL_SECRET = 'weak'
    expect(getPortalSecret()).toBe('n'.repeat(40)) // repli sur NEXTAUTH_SECRET, jamais en dur
  })

  it('getPortalSecret LÈVE si aucun secret fort disponible', () => {
    delete process.env.NEXTAUTH_SECRET
    delete process.env.GF_PORTAL_SECRET
    expect(() => getPortalSecret()).toThrow()
  })
})
