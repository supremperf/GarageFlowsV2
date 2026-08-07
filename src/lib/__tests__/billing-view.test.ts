/**
 * Robustesse d'affichage Factures/Devis (Phase 3/4) — anti-crash « Une erreur
 * est survenue ». Reproduit les entrées qui faisaient tomber la page entière et
 * prouve qu'elles ne jettent plus.
 */
import { describe, it, expect } from 'vitest'
import { asDocArray, safeAmount, formatAmount, docMatchesSearch, sumTTC } from '@/lib/billing-view'

describe('asDocArray — réponse API toujours normalisée en tableau', () => {
  it('tableau nu → tel quel', () => {
    expect(asDocArray([1, 2, 3])).toEqual([1, 2, 3])
  })
  it('enveloppe { data: [...] } → data', () => {
    expect(asDocArray({ data: [{ id: 'a' }] })).toEqual([{ id: 'a' }])
  })
  it('objet d’erreur { error } → [] (pas de crash filter/reduce)', () => {
    expect(asDocArray({ error: 'Accès refusé' })).toEqual([])
  })
  it('null / undefined / nombre / chaîne → []', () => {
    expect(asDocArray(null)).toEqual([])
    expect(asDocArray(undefined)).toEqual([])
    expect(asDocArray(42)).toEqual([])
    expect(asDocArray('oops')).toEqual([])
  })
  it('le résultat supporte TOUJOURS filter/reduce/map', () => {
    const arr = asDocArray({ error: 'x' })
    expect(() => arr.filter(Boolean).map((x) => x).reduce((a) => a, 0)).not.toThrow()
  })
})

describe('safeAmount / formatAmount — jamais de NaN ni de crash .toFixed', () => {
  it('nombre fini → lui-même', () => {
    expect(safeAmount(12.5)).toBe(12.5)
    expect(formatAmount(12.5)).toBe('12.50')
  })
  it('undefined / null → 0', () => {
    expect(safeAmount(undefined)).toBe(0)
    expect(safeAmount(null)).toBe(0)
    expect(formatAmount(undefined)).toBe('0.00')
  })
  it('NaN / Infinity → 0 (jamais « NaN € »)', () => {
    expect(safeAmount(NaN)).toBe(0)
    expect(safeAmount(Infinity)).toBe(0)
    expect(formatAmount(NaN)).toBe('0.00')
  })
  it('chaîne numérique legacy → nombre ; chaîne non numérique → 0', () => {
    expect(safeAmount('123.4')).toBe(123.4)
    expect(safeAmount('abc')).toBe(0)     // ne jette pas « toFixed is not a function »
    expect(formatAmount('abc', 0)).toBe('0')
  })
})

describe('docMatchesSearch — robuste aux documents legacy à champs null', () => {
  it('document avec number null → pas de crash, filtré correctement', () => {
    const legacy = { number: null, clientName: null, status: 'draft' }
    expect(() => docMatchesSearch(legacy, 'fac')).not.toThrow()
    expect(docMatchesSearch(legacy, 'fac')).toBe(false)
    expect(docMatchesSearch(legacy, '')).toBe(true) // recherche vide → tout passe
  })
  it('recherche sur number / client / véhicule / plaque', () => {
    const d = { number: 'FAC-2026-001', clientName: 'Dupont', vehicleModel: 'Clio', licensePlate: 'AB-123-CD' }
    expect(docMatchesSearch(d, 'fac-2026')).toBe(true)
    expect(docMatchesSearch(d, 'dupont')).toBe(true)
    expect(docMatchesSearch(d, 'clio')).toBe(true)
    expect(docMatchesSearch(d, 'ab-123')).toBe(true)
    expect(docMatchesSearch(d, 'zzz')).toBe(false)
  })
  it('préfère les champs job.* quand présents', () => {
    const d = { number: 'X', clientName: 'Ancien', job: { customerName: 'Nouveau' } }
    expect(docMatchesSearch(d, 'nouveau')).toBe(true)
  })
})

describe('sumTTC — somme robuste', () => {
  it('ignore les montants non finis (comptés 0)', () => {
    expect(sumTTC([{ totalTTC: 10 }, { totalTTC: undefined }, { totalTTC: 'x' }, { totalTTC: 5 }])).toBe(15)
  })
  it('entrée non-tableau → 0 (pas de crash)', () => {
    // @ts-expect-error test de robustesse : entrée volontairement invalide
    expect(sumTTC({ error: 'x' })).toBe(0)
  })
})
