import { describe, it, expect } from 'vitest'
// Helpers du processus principal (CommonJS) — logique pure, testable ici.
import cp from '../../../electron/control-plane.js'

/**
 * GF31-AUD-043 — le plan de contrôle était mort sur tout le parc packagé.
 *
 * `resolveRemoteBase` ne lisait que `GF_LICENSE_SERVER`. Une application
 * packagée n'embarque aucun `.env` : la variable est absente en production, la
 * fonction rendait `null`, et ses trois consommateurs — file de crash,
 * récupération des notifications, accusé de réception — sortaient EN SILENCE.
 *
 * L'ancienne version de ce test verrouillait le défaut : elle exigeait
 * `resolveRemoteBase({}) === null` sans distinguer développement et production.
 */
describe('resolveRemoteBase', () => {
  it('supprime le slash final', () => {
    expect(cp.resolveRemoteBase({ GF_LICENSE_SERVER: 'https://app.garageflows.fr/' })).toBe('https://app.garageflows.fr')
  })

  it('développement sans configuration : null (aucune télémétrie de mise au point en production)', () => {
    expect(cp.resolveRemoteBase({})).toBeNull()
    expect(cp.resolveRemoteBase({ GF_LICENSE_SERVER: '   ' })).toBeNull()
    expect(cp.resolveRemoteBase({}, { isPackaged: false })).toBeNull()
  })

  it('PRODUCTION packagée sans configuration : autorité officielle compilée', () => {
    const base = cp.resolveRemoteBase({}, { isPackaged: true })
    expect(base).toBe('https://app.garageflows.fr')
    expect(base).not.toBeNull()
  })

  it('la surcharge d’environnement fait foi quand elle est en HTTPS', () => {
    expect(cp.resolveRemoteBase({ GF_LICENSE_SERVER: 'https://staging.example.fr' }, { isPackaged: true }))
      .toBe('https://staging.example.fr')
    // Hors packaging, tout est permis (dev local en clair).
    expect(cp.resolveRemoteBase({ GF_LICENSE_SERVER: 'http://127.0.0.1:3000' }, { isPackaged: false }))
      .toBe('http://127.0.0.1:3000')
  })

  it('en production packagée, une surcharge NON https est refusée (anti-downgrade)', () => {
    expect(cp.resolveRemoteBase({ GF_LICENSE_SERVER: 'http://mechant.example' }, { isPackaged: true }))
      .toBe('https://app.garageflows.fr')
  })

  it('la même autorité que la licence — les deux ne peuvent pas diverger', async () => {
    const le = await import('../../../electron/license-endpoint.js')
    expect(cp.resolveRemoteBase({}, { isPackaged: true }))
      .toBe((le as unknown as { OFFICIAL_LICENSE_SERVER: string }).OFFICIAL_LICENSE_SERVER)
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

describe('sha256HexEqual (vérification des mises à jour)', () => {
  const a = 'a'.repeat(64)
  it('égalité stricte (insensible à la casse / espaces)', () => {
    expect(cp.sha256HexEqual(a, a.toUpperCase())).toBe(true)
    expect(cp.sha256HexEqual(` ${a} `, a)).toBe(true)
  })
  it('rejette les empreintes différentes', () => {
    expect(cp.sha256HexEqual(a, 'b'.repeat(64))).toBe(false)
  })
  it('rejette les entrées malformées ou absentes', () => {
    expect(cp.sha256HexEqual(a, 'xyz')).toBe(false)
    expect(cp.sha256HexEqual(a, '')).toBe(false)
    expect(cp.sha256HexEqual(null as any, a)).toBe(false)
    expect(cp.sha256HexEqual(a, a.slice(0, 63))).toBe(false)
  })
})

describe('pushBounded', () => {
  it('borne la file en gardant les plus récents', () => {
    let list: number[] = []
    for (let i = 0; i < 10; i++) list = cp.pushBounded(list, i, 3)
    expect(list).toEqual([7, 8, 9])
  })
})
