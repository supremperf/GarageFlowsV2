/**
 * Décision de revalidation de session (révocation JWT côté serveur).
 */
import { describe, it, expect } from 'vitest'
import { sessionRevalidationDecision } from '../session-revalidation'

describe('sessionRevalidationDecision', () => {
  it('révoque si le compte est introuvable', () => {
    const d = sessionRevalidationDecision({ dbUser: null, tokenEpoch: 0 })
    expect(d.revoked).toBe(true)
    expect(d.reason).toBe('not_found')
  })
  it('révoque un compte suspendu', () => {
    const d = sessionRevalidationDecision({ dbUser: { status: 'suspended', sessionEpoch: 0, role: 'OWNER' }, tokenEpoch: 0 })
    expect(d.revoked).toBe(true)
    expect(d.reason).toBe('inactive')
  })
  it('révoque si le sessionEpoch a changé (révocation explicite)', () => {
    const d = sessionRevalidationDecision({ dbUser: { status: 'active', sessionEpoch: 3, role: 'OWNER' }, tokenEpoch: 2 })
    expect(d.revoked).toBe(true)
    expect(d.reason).toBe('epoch_mismatch')
  })
  it('accepte un compte actif avec epoch concordant et propage le rôle courant', () => {
    const d = sessionRevalidationDecision({ dbUser: { status: 'active', sessionEpoch: 5, role: 'MANAGER' }, tokenEpoch: 5 })
    expect(d.revoked).toBe(false)
    expect(d.role).toBe('MANAGER')
  })
  it('accepte un token sans epoch (émis avant la fonctionnalité) si le compte est actif', () => {
    const d = sessionRevalidationDecision({ dbUser: { status: 'active', sessionEpoch: 0, role: 'OWNER' }, tokenEpoch: undefined })
    expect(d.revoked).toBe(false)
    expect(d.role).toBe('OWNER')
  })
})
