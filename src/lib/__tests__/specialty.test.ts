/**
 * parseSpecialty ne LÈVE jamais (une ligne Mechanic.specialty corrompue ne doit
 * plus faire planter /api/suggestions) ; normalizeSpecialty stocke toujours du JSON.
 */
import { describe, it, expect } from 'vitest'
import { parseSpecialty, normalizeSpecialty } from '@/lib/specialty'

describe('parseSpecialty (jamais d\'exception)', () => {
  it('tableau JSON stocké → tableau', () => {
    expect(parseSpecialty('["moteur","freins"]')).toEqual(['moteur', 'freins'])
  })
  it('tableau direct → filtré aux strings', () => {
    expect(parseSpecialty(['a', 1, 'b', null])).toEqual(['a', 'b'])
  })
  it('chaîne NON-JSON (donnée corrompue) → [] sans lever', () => {
    expect(parseSpecialty('moteur')).toEqual([])
    expect(parseSpecialty('{oops')).toEqual([])
  })
  it('JSON non-tableau / null / undefined / nombre → []', () => {
    expect(parseSpecialty('{"a":1}')).toEqual([])
    expect(parseSpecialty(null)).toEqual([])
    expect(parseSpecialty(undefined)).toEqual([])
    expect(parseSpecialty(42)).toEqual([])
  })
})

describe('normalizeSpecialty (toujours du JSON valide)', () => {
  it('normalise tableau et chaîne en JSON de tableau', () => {
    expect(normalizeSpecialty(['x', 'y'])).toBe('["x","y"]')
    expect(normalizeSpecialty('moteur')).toBe('[]') // entrée invalide → tableau vide
    expect(JSON.parse(normalizeSpecialty('["ok"]'))).toEqual(['ok'])
  })
})
