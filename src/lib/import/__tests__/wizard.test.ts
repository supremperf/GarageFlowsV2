/**
 * Planification d'import (DRY-RUN, pur) : mapping auto, validation, dédoublonnage
 * (fichier + existant), neutralisation de cellules, erreurs par ligne.
 */
import { describe, it, expect } from 'vitest'
import { autoMap, planImport, entityFields } from '../wizard'

describe('autoMap', () => {
  it('mappe les en-têtes clients (FR/EN) vers les champs', () => {
    const m = autoMap('clients', ['Nom', 'Téléphone', 'E-mail', 'Adresse'])
    expect(m).toEqual({ name: 0, phone: 1, email: 2, address: 3 })
  })
  it('mappe les en-têtes pièces', () => {
    const m = autoMap('parts', ['Référence', 'Désignation', 'Quantité', 'Prix'])
    expect(m.reference).toBe(0)
    expect(m.name).toBe(1)
    expect(m.quantity).toBe(2)
    expect(m.unitPrice).toBe(3)
  })
  it('expose les champs connus', () => {
    expect(entityFields('clients')).toContain('name')
    expect(entityFields('parts')).toContain('reference')
  })
})

describe('planImport — clients', () => {
  const mapping = { name: 0, phone: 1, email: 2 }
  it('planifie les créations, valide, compte les cellules neutralisées', () => {
    const rows = [
      ['Jean Dupont', '+33 1 23 45 67', 'jean@x.fr'],
      ['=SUM(A1)', '0102030405', 'bad@x.fr'],     // nom neutralisé → devient "'=SUM(A1)" (valide)
      ['', '0000', 'noname@x.fr'],                 // nom vide → erreur
    ]
    const plan = planImport({ entity: 'clients', rows, mapping, existingKeys: new Set() })
    expect(plan.totalRows).toBe(3)
    expect(plan.toCreate).toHaveLength(2)
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0].row).toBe(4) // +2 (en-tête + base 1)
    expect(plan.sanitizedCells).toBe(1)
    expect(plan.toCreate[1].name).toBe("'=SUM(A1)")
  })

  it('détecte les doublons DANS le fichier (par email)', () => {
    const rows = [
      ['Jean', '01', 'j@x.fr'],
      ['Jean bis', '02', 'j@x.fr'], // même email → doublon fichier
    ]
    const plan = planImport({ entity: 'clients', rows, mapping, existingKeys: new Set() })
    expect(plan.toCreate).toHaveLength(1)
    expect(plan.duplicatesInFile).toBe(1)
  })

  it('détecte les doublons vs EXISTANT', () => {
    const rows = [['Jean', '01', 'j@x.fr']]
    const plan = planImport({ entity: 'clients', rows, mapping, existingKeys: new Set(['email:j@x.fr']) })
    expect(plan.toCreate).toHaveLength(0)
    expect(plan.duplicatesExisting).toBe(1)
  })
})

describe('planImport — parts', () => {
  const mapping = { reference: 0, name: 1, quantity: 2, unitPrice: 3 }
  it('coerce les nombres et rejette les non-nombres', () => {
    const rows = [
      ['REF1', 'Filtre huile', '10', '12.50'],
      ['REF2', 'Plaquettes', 'abc', '30'],  // quantité non numérique → erreur
    ]
    const plan = planImport({ entity: 'parts', rows, mapping, existingKeys: new Set() })
    expect(plan.toCreate).toHaveLength(1)
    expect(plan.toCreate[0]).toMatchObject({ reference: 'REF1', quantity: 10, unitPrice: 12.5 })
    expect(plan.errors).toHaveLength(1)
  })
  it('dédoublonne par référence', () => {
    const rows = [
      ['REF1', 'A', '1', '1'],
      ['ref1', 'B', '2', '2'], // même référence (casse-insensible) → doublon
    ]
    const plan = planImport({ entity: 'parts', rows, mapping, existingKeys: new Set() })
    expect(plan.toCreate).toHaveLength(1)
    expect(plan.duplicatesInFile).toBe(1)
  })
})
