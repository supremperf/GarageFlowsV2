import { describe, it, expect } from 'vitest'
// Helpers du processus principal (CommonJS) — logique pure, testable ici.
import cp from '../../../electron/control-plane.js'

describe('resolveRemoteBase', () => {
  it('supprime le slash final', () => {
    expect(cp.resolveRemoteBase({ GF_LICENSE_SERVER: 'https://app.garageflows.fr/' })).toBe('https://app.garageflows.fr')
  })
  it('renvoie null si absent', () => {
    expect(cp.resolveRemoteBase({})).toBeNull()
    expect(cp.resolveRemoteBase({ GF_LICENSE_SERVER: '   ' })).toBeNull()
  })
})

describe('computeCrashFingerprint (identique au serveur)', () => {
  it('regroupe deux crashs identiques aux détails près', () => {
    const s1 = 'Error: x\n    at foo (/a/b.js:10:5)'
    const s2 = 'Error: x\n    at foo (/a/b.js:88:1)'
    expect(cp.computeCrashFingerprint('boom 1', s1, '1.2.0')).toBe(cp.computeCrashFingerprint('boom 2', s2, '1.2.9'))
  })
  it('distingue des piles différentes', () => {
    const s1 = 'Error\n    at foo (/a.js:1:1)'
    const s2 = 'Error\n    at bar (/a.js:1:1)'
    expect(cp.computeCrashFingerprint('m', s1, '1.0.0')).not.toBe(cp.computeCrashFingerprint('m', s2, '1.0.0'))
  })
  it('produit une empreinte hex de 24 caractères', () => {
    expect(cp.computeCrashFingerprint('m', null, '1.0.0')).toMatch(/^[a-f0-9]{24}$/)
  })
})

describe('detectClockRollback', () => {
  const skew = 15 * 60 * 1000
  it('détecte un recul au-delà de la tolérance', () => {
    const trusted = 1_000_000_000_000
    expect(cp.detectClockRollback(trusted, trusted - skew - 1, skew)).toBe(true)
  })
  it('tolère une petite dérive et l\'avance normale', () => {
    const trusted = 1_000_000_000_000
    expect(cp.detectClockRollback(trusted, trusted - 1000, skew)).toBe(false)
    expect(cp.detectClockRollback(trusted, trusted + 999_999, skew)).toBe(false)
  })
  it('sans référence → jamais de tamper', () => {
    expect(cp.detectClockRollback(null, Date.now(), skew)).toBe(false)
  })
})

describe('pushBounded', () => {
  it('borne la file en gardant les plus récents', () => {
    let list: number[] = []
    for (let i = 0; i < 10; i++) list = cp.pushBounded(list, i, 3)
    expect(list).toEqual([7, 8, 9])
  })
})
