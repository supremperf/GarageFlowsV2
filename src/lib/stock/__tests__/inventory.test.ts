/**
 * Moteur d'inventaire — logique PURE de rapprochement (delta).
 *
 * Prouve la règle qui empêche le double décrément : passer une ligne de 2 à 3
 * ne retire QUE 1 de plus, jamais 3 à nouveau.
 */
import { describe, it, expect } from 'vitest'
import {
  unitsFromScaledQuantity,
  lineConsumesStock,
  aggregateStockDemand,
  computeInventoryDelta,
  committedFromMovements,
  InventoryError,
} from '@/lib/stock/inventory'

const SCALE = 10_000
const qty = (units: number) => units * SCALE

describe('conversion quantité ligne → unités de stock', () => {
  it('convertit exactement les quantités entières', () => {
    expect(unitsFromScaledQuantity(qty(1))).toBe(1)
    expect(unitsFromScaledQuantity(qty(2))).toBe(2)
    expect(unitsFromScaledQuantity(qty(75))).toBe(75)
  })

  it('refuse une quantité FRACTIONNAIRE (le stock se gère en unités)', () => {
    expect(unitsFromScaledQuantity(15_000)).toBeNull() // 1,5
    expect(unitsFromScaledQuantity(1)).toBeNull()      // 0,0001
  })

  it('refuse zéro, négatif, NaN, Infinity et l’aberrant', () => {
    for (const v of [0, -SCALE, NaN, Infinity, -Infinity, 200_001 * SCALE]) {
      expect(unitsFromScaledQuantity(v)).toBeNull()
    }
  })
})

describe('quelles lignes consomment du stock', () => {
  it('STOCK ITEM (partId) → oui ; LABOUR → non ; FREE LINE → non', () => {
    expect(lineConsumesStock({ partId: 'p1', quantityTenThousandths: qty(1) })).toBe(true)
    expect(lineConsumesStock({ partId: 'p1', isLabor: true, quantityTenThousandths: qty(1) })).toBe(false)
    expect(lineConsumesStock({ quantityTenThousandths: qty(1) })).toBe(false)
    expect(lineConsumesStock({ partId: null, quantityTenThousandths: qty(1) })).toBe(false)
    expect(lineConsumesStock({ partId: '', quantityTenThousandths: qty(1) })).toBe(false)
  })
})

describe('agrégation de la demande', () => {
  it('additionne deux lignes portant la MÊME pièce', () => {
    const d = aggregateStockDemand([
      { partId: 'p1', quantityTenThousandths: qty(2) },
      { partId: 'p1', quantityTenThousandths: qty(3) },
      { partId: 'p2', quantityTenThousandths: qty(1) },
    ])
    expect(d.get('p1')).toBe(5)
    expect(d.get('p2')).toBe(1)
  })

  it('ignore main-d’œuvre et lignes libres', () => {
    const d = aggregateStockDemand([
      { isLabor: true, quantityTenThousandths: qty(2), description: 'Main-d’œuvre' },
      { quantityTenThousandths: qty(4), description: 'Pièce commandée spécialement' },
      { partId: 'p1', quantityTenThousandths: qty(1) },
    ])
    expect(Array.from(d.entries())).toEqual([['p1', 1]])
  })

  it('lève sur une quantité inexploitable en stock', () => {
    expect(() => aggregateStockDemand([{ partId: 'p1', quantityTenThousandths: 15_000, description: 'Filtre' }]))
      .toThrow(InventoryError)
  })
})

describe('DELTA — le cœur de la synchronisation', () => {
  const m = (o: Record<string, number>) => new Map(Object.entries(o))

  it('validation initiale : engagé ∅ → cible 2 ⇒ sortir 2', () => {
    expect(computeInventoryDelta(m({}), m({ p1: 2 }))).toEqual([{ partId: 'p1', units: 2 }])
  })

  it('2 → 3 : ne retire QUE 1 de plus (jamais 3 à nouveau)', () => {
    expect(computeInventoryDelta(m({ p1: 2 }), m({ p1: 3 }))).toEqual([{ partId: 'p1', units: 1 }])
  })

  it('3 → 1 : restitue 2', () => {
    expect(computeInventoryDelta(m({ p1: 3 }), m({ p1: 1 }))).toEqual([{ partId: 'p1', units: -2 }])
  })

  it('2 → 0 / suppression de ligne : restitue tout', () => {
    expect(computeInventoryDelta(m({ p1: 2 }), m({}))).toEqual([{ partId: 'p1', units: -2 }])
  })

  it('changement de pièce A → B : restitue A et sort B en une passe', () => {
    expect(computeInventoryDelta(m({ pA: 2 }), m({ pB: 2 }))).toEqual([
      { partId: 'pA', units: -2 },
      { partId: 'pB', units: 2 },
    ])
  })

  it('cible identique ⇒ AUCUN mouvement (idempotence naturelle)', () => {
    expect(computeInventoryDelta(m({ p1: 2, p2: 5 }), m({ p1: 2, p2: 5 }))).toEqual([])
  })

  it('ordre DÉTERMINISTE des pièces (anti-interblocage croisé)', () => {
    const a = computeInventoryDelta(m({ z: 1, a: 1 }), m({}))
    const b = computeInventoryDelta(m({ a: 1, z: 1 }), m({}))
    expect(a.map(d => d.partId)).toEqual(['a', 'z'])
    expect(a).toEqual(b)
  })
})

describe('reconstitution de l’engagement depuis le journal', () => {
  it('une vente de 2 (delta −2) vaut 2 unités engagées', () => {
    const c = committedFromMovements([{ partId: 'p1', quantityDelta: -2 }])
    expect(c.get('p1')).toBe(2)
  })

  it('vente puis annulation symétrique ⇒ plus rien d’engagé', () => {
    const c = committedFromMovements([
      { partId: 'p1', quantityDelta: -2 },
      { partId: 'p1', quantityDelta: 2 },
    ])
    expect(c.has('p1')).toBe(false)
  })

  it('vente 2 puis ajustement −1 ⇒ 3 engagées', () => {
    const c = committedFromMovements([
      { partId: 'p1', quantityDelta: -2 },
      { partId: 'p1', quantityDelta: -1 },
    ])
    expect(c.get('p1')).toBe(3)
  })
})
