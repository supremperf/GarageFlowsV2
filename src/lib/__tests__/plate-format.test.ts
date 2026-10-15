/**
 * Une sortie de modèle n'est pas une lecture tant qu'elle n'a pas la FORME d'une
 * immatriculation.
 *
 * Ces tests protègent la porte d'entrée de la reconnaissance de plaque : sans
 * elle, une phrase du modèle devenait une plaque, était recopiée dans le champ,
 * déclenchait la recherche véhicule, et finissait dans l'intervention, le devis
 * et la facture (même défaut que GF-FINAL-020, par une autre porte).
 */
import { describe, it, expect } from 'vitest'
import { normaliserPlaque } from '@/lib/plate-format'

describe('ce qui est une immatriculation est accepté', () => {
  it.each([
    ['AB-123-CD', 'AB-123-CD'],
    ['ab-123-cd', 'AB-123-CD'],
    ['AB123CD', 'AB-123-CD'],
    ['AB 123 CD', 'AB-123-CD'],
    ['  AB-123-CD  ', 'AB-123-CD'],
  ])('SIV : %s → %s', (brut, attendu) => {
    expect(normaliserPlaque(brut)).toBe(attendu)
  })

  it.each([
    ['1234-AB-75', '1234-AB-75'],
    ['1234 AB 75', '1234-AB-75'],
    ['123-ABC-45', '123-ABC-45'],
  ])('FNI, encore en circulation : %s → %s', (brut, attendu) => {
    expect(normaliserPlaque(brut), 'refuser le FNI exclurait les véhicules d’avant 2009')
      .toBe(attendu)
  })

  it('la mise en forme ne CORRIGE rien : aucune lettre substituée', () => {
    // Un « 0 » lu reste un « 0 » : le deviner en « O » inventerait une plaque.
    expect(normaliserPlaque('AB-013-CD')).toBe('AB-013-CD')
  })
})

describe('ce qui n’en est pas une est refusé', () => {
  it.each([
    'Je ne distingue pas la plaque',
    'La plaque est illisible sur cette photo',
    'AB-12-CD',
    'ABC-123-DEF',
    'Sorry, I cannot read this image',
    '',
    '???',
    'null',
  ])('refuse « %s »', (brut) => {
    expect(normaliserPlaque(brut), 'le doute doit profiter au refus').toBeNull()
  })

  it('une phrase ne devient jamais une plaque par simple nettoyage', () => {
    // C'était le défaut : majuscules + tirets suffisaient à la faire passer.
    expect(normaliserPlaque('je ne vois pas de plaque')).toBeNull()
  })

  it('une entrée non textuelle est refusée sans lever', () => {
    expect(normaliserPlaque(undefined as unknown as string)).toBeNull()
    expect(normaliserPlaque(null as unknown as string)).toBeNull()
  })
})
