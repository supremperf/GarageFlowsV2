/**
 * Décisions d'accès abonnement — matrice d'états × échéances (logique pure).
 */
import { describe, it, expect } from 'vitest'
import {
  decideAccess, effectiveStatus, isAccessAllowed, statusFromExternal, type SubscriptionState,
} from '../subscription'

const NOW = new Date('2026-06-15T12:00:00Z')
const past = new Date('2026-06-01T00:00:00Z')
const future = new Date('2026-07-01T00:00:00Z')

describe('decideAccess — aucun abonnement', () => {
  it('refuse l\'accès sans abonnement', () => {
    const d = decideAccess(null, NOW)
    expect(d.allowed).toBe(false)
    expect(d.effectiveStatus).toBe('none')
  })
})

describe('essai (trial)', () => {
  it('accès pendant l\'essai', () => {
    const s: SubscriptionState = { status: 'trial', trialEndsAt: future }
    expect(decideAccess(s, NOW).allowed).toBe(true)
    expect(effectiveStatus(s, NOW)).toBe('trial')
  })
  it('refus après expiration de l\'essai (bascule suspended)', () => {
    const s: SubscriptionState = { status: 'trial', trialEndsAt: past }
    expect(effectiveStatus(s, NOW)).toBe('suspended')
    expect(decideAccess(s, NOW).allowed).toBe(false)
  })
})

describe('actif (active)', () => {
  it('accès tant que la période court', () => {
    const s: SubscriptionState = { status: 'active', currentPeriodEnd: future }
    expect(decideAccess(s, NOW).allowed).toBe(true)
  })
  it('période échue + fenêtre de grâce → grace (accès maintenu)', () => {
    const s: SubscriptionState = { status: 'active', currentPeriodEnd: past, graceEndsAt: future }
    expect(effectiveStatus(s, NOW)).toBe('grace')
    expect(decideAccess(s, NOW).allowed).toBe(true)
  })
  it('période échue sans grâce → suspended (refus)', () => {
    const s: SubscriptionState = { status: 'active', currentPeriodEnd: past }
    expect(effectiveStatus(s, NOW)).toBe('suspended')
    expect(decideAccess(s, NOW).allowed).toBe(false)
  })
  it('période échue + grâce échue → suspended (refus)', () => {
    const s: SubscriptionState = { status: 'active', currentPeriodEnd: past, graceEndsAt: past }
    expect(decideAccess(s, NOW).allowed).toBe(false)
  })
})

describe('grâce (grace)', () => {
  it('accès pendant la grâce', () => {
    expect(isAccessAllowed({ status: 'grace', graceEndsAt: future }, NOW)).toBe(true)
  })
  it('refus après la grâce', () => {
    expect(isAccessAllowed({ status: 'grace', graceEndsAt: past }, NOW)).toBe(false)
  })
})

describe('suspended / cancelled', () => {
  it('suspended → refus', () => {
    expect(decideAccess({ status: 'suspended' }, NOW).allowed).toBe(false)
  })
  it('cancelled → refus', () => {
    const d = decideAccess({ status: 'cancelled' }, NOW)
    expect(d.allowed).toBe(false)
    expect(d.effectiveStatus).toBe('cancelled')
  })
})

describe('statusFromExternal (fail-closed)', () => {
  it('mappe les statuts connus', () => {
    expect(statusFromExternal('trialing')).toBe('trial')
    expect(statusFromExternal('active')).toBe('active')
    expect(statusFromExternal('past_due')).toBe('grace')
    expect(statusFromExternal('canceled')).toBe('cancelled')
    expect(statusFromExternal('paused')).toBe('suspended')
  })
  it('mappe un statut inconnu sur suspended (prudent)', () => {
    expect(statusFromExternal('wat')).toBe('suspended')
  })
})
