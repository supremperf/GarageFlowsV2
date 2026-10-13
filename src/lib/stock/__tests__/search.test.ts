/**
 * Recherche de pièces — scénario exact de la spécification :
 * on tape « F », on doit voir les pièces correspondantes ; on précise « Fil »,
 * la liste se réduit.
 */
import { describe, it, expect } from 'vitest'
import { normalizeSearch, rankParts, scorePart, isNarrowingQuery } from '@/lib/stock/search'

const STOCK = [
  { id: '1', name: 'Filtre à huile', reference: 'P3312', supplierName: 'Bosch', supplierRef: 'BO-3312' },
  { id: '2', name: 'Filtre à air', reference: 'P4410', supplierName: 'Mann', supplierRef: null },
  { id: '3', name: 'Filtre habitacle', reference: 'P5520', supplierName: 'Mann', supplierRef: null },
  { id: '4', name: 'Flexible de frein', reference: 'F1200', supplierName: 'TRW', supplierRef: null },
  { id: '5', name: 'Feu arrière', reference: 'L9000', supplierName: 'Valeo', supplierRef: null },
  { id: '6', name: 'Bougie', reference: 'B7712', supplierName: 'NGK', supplierRef: null },
  { id: '7', name: 'Préfiltre gasoil', reference: 'D2200', supplierName: 'Delphi', supplierRef: null },
]

const names = (q: string, limit = 20) => rankParts(STOCK, q, limit).map(p => p.name)

describe('normalisation', () => {
  it('supprime casse et accents', () => {
    expect(normalizeSearch('FILTRE À HUILE')).toBe('filtre a huile')
    expect(normalizeSearch('  Préfiltre   gasoil ')).toBe('prefiltre gasoil')
  })
})

describe('scénario de la spécification', () => {
  it('« F » propose toutes les pièces commençant par F', () => {
    const r = names('F')
    expect(r).toContain('Filtre à huile')
    expect(r).toContain('Filtre à air')
    expect(r).toContain('Filtre habitacle')
    expect(r).toContain('Flexible de frein')
    expect(r).toContain('Feu arrière')
    expect(r).not.toContain('Bougie')
  })

  it('« Fil » réduit aux filtres et écarte Flexible / Feu', () => {
    const r = names('Fil')
    expect(r).not.toContain('Flexible de frein')
    expect(r).not.toContain('Feu arrière')
    expect(r).not.toContain('Bougie')
    // Les pièces COMMENÇANT par « Fil » passent devant celles qui ne font que
    // le contenir (« Préfiltre » reste proposé : c'est bien une correspondance).
    expect(r.slice(0, 3).sort()).toEqual(['Filtre habitacle', 'Filtre à air', 'Filtre à huile'].sort())
    expect(r).toContain('Préfiltre gasoil')
    expect(r.indexOf('Préfiltre gasoil')).toBeGreaterThan(2)
  })

  it('minuscules et majuscules donnent le MÊME résultat', () => {
    expect(names('fil')).toEqual(names('FIL'))
  })

  it('accents tolérés dans les deux sens', () => {
    expect(names('prefiltre')).toContain('Préfiltre gasoil')
    expect(names('préfiltre')).toContain('Préfiltre gasoil')
  })

  it('recherche par référence, avec ou sans ponctuation', () => {
    expect(names('P3312')).toEqual(['Filtre à huile'])
    expect(names('p-3312')).toEqual(['Filtre à huile'])
  })

  it('recherche par référence FOURNISSEUR et par fournisseur', () => {
    expect(names('BO3312')).toEqual(['Filtre à huile'])
    expect(names('Mann')).toEqual(expect.arrayContaining(['Filtre à air', 'Filtre habitacle']))
  })

  it('début d’un MOT du nom : « hui » trouve « Filtre à huile »', () => {
    expect(names('hui')).toContain('Filtre à huile')
  })
})

describe('classement', () => {
  it('la référence exacte passe devant tout le reste', () => {
    expect(scorePart(STOCK[0], normalizeSearch('P3312'))).toBe(0)
    expect(scorePart(STOCK[0], normalizeSearch('filtre'))).toBeGreaterThan(0)
  })

  it('aucune correspondance ⇒ écarté', () => {
    expect(scorePart(STOCK[0], normalizeSearch('turbo'))).toBeNull()
    expect(names('turbo')).toEqual([])
  })

  it('la limite est respectée', () => {
    expect(names('F', 2)).toHaveLength(2)
  })

  it('ordre STABLE à score égal (deux appels identiques)', () => {
    expect(names('Fil')).toEqual(names('Fil'))
  })
})

describe('affinage local (zéro requête réseau)', () => {
  it('« F » → « Fil » est un affinage', () => {
    expect(isNarrowingQuery('F', 'Fil')).toBe(true)
  })
  it('« Fil » → « F » ou une requête différente n’en est pas un', () => {
    expect(isNarrowingQuery('Fil', 'F')).toBe(false)
    expect(isNarrowingQuery('Fil', 'Bou')).toBe(false)
    expect(isNarrowingQuery('', 'F')).toBe(false)
  })
  it('reclasser localement le résultat de « F » avec « Fil » donne le même jeu que le serveur', () => {
    const serverForF = rankParts(STOCK, 'F', 20)
    expect(rankParts(serverForF, 'Fil', 20).map(p => p.name)).toEqual(names('Fil'))
  })
})
