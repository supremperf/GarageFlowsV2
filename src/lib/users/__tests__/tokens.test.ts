/**
 * Jetons de récupération — hachage au repos, usage unique, expiration.
 */
import { describe, it, expect } from 'vitest'
import { generateToken, hashToken, tokenExpiry, isTokenUsable, TOKEN_TTL_MS } from '../tokens'

describe('generateToken / hashToken', () => {
  it('génère un jeton aléatoire et son empreinte SHA-256', () => {
    const { token, tokenHash } = generateToken()
    expect(token.length).toBeGreaterThanOrEqual(40)
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(tokenHash).toBe(hashToken(token))
    // Le jeton en clair ne se déduit pas de l'empreinte.
    expect(tokenHash).not.toContain(token)
  })
  it('deux générations diffèrent', () => {
    expect(generateToken().token).not.toBe(generateToken().token)
  })
})

describe('tokenExpiry', () => {
  it('applique la TTL par type', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    expect(tokenExpiry('password_reset', now).getTime()).toBe(now.getTime() + TOKEN_TTL_MS.password_reset)
    expect(tokenExpiry('invite', now).getTime()).toBe(now.getTime() + TOKEN_TTL_MS.invite)
  })
})

describe('isTokenUsable', () => {
  const now = new Date('2026-01-01T12:00:00Z')
  it('utilisable si non consommé et non expiré', () => {
    expect(isTokenUsable({ usedAt: null, expiresAt: new Date(now.getTime() + 1000) }, now)).toBe(true)
  })
  it('inutilisable si déjà consommé', () => {
    expect(isTokenUsable({ usedAt: now, expiresAt: new Date(now.getTime() + 1000) }, now)).toBe(false)
  })
  it('inutilisable si expiré', () => {
    expect(isTokenUsable({ usedAt: null, expiresAt: new Date(now.getTime() - 1) }, now)).toBe(false)
  })
})
