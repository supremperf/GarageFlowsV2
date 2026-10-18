import { describe, it, expect } from 'vitest'
import { computeReorderPlan, planReorders, type StockItemInput } from '../index'

const base: Omit<StockItemInput, 'id' | 'name' | 'currentStock'> = {
  unitCost: 4,
  leadTimeDays: 7,
  periodDays: 30,
  packSize: 1,
  serviceZ: 1.28,
}

describe('computeReorderPlan', () => {
  it('recommends an order when stock is below the reorder point (critical)', () => {
    const plan = computeReorderPlan({ id: 'p1', name: 'Filtre', currentStock: 2, ...base }, [10, 10, 10])
    expect(plan.reorderPoint).toBe(3)
    expect(plan.daysToStockout).toBe(6)
    expect(plan.shouldReorder).toBe(true)
    expect(plan.recommendedOrderQty).toBe(11) // target 13 − current 2
    expect(plan.estimatedCost).toBe(44) // 11 × 4
    expect(plan.urgency).toBe('critical') // stockout within lead time
  })

  it('does not reorder when stock is ample', () => {
    const plan = computeReorderPlan({ id: 'p2', name: 'Vis', currentStock: 1000, ...base }, [10, 10, 10])
    expect(plan.shouldReorder).toBe(false)
    expect(plan.recommendedOrderQty).toBe(0)
    expect(plan.urgency).toBe('low')
  })

  it('handles zero consumption (no stockout risk)', () => {
    const plan = computeReorderPlan({ id: 'p3', name: 'Inactif', currentStock: 5, ...base }, [0, 0, 0])
    expect(plan.daysToStockout).toBeNull()
    expect(plan.shouldReorder).toBe(false)
    expect(plan.urgency).toBe('none')
  })

  it('reorders up to the minimum-stock floor even without imminent stockout', () => {
    const plan = computeReorderPlan({ id: 'p4', name: 'Joint', currentStock: 3, minStock: 5, ...base }, [1, 1, 1])
    expect(plan.shouldReorder).toBe(true)
    expect(plan.recommendedOrderQty).toBe(2) // up to min 5
    expect(plan.rationale.join(' ')).toMatch(/seuil/)
  })

  it('rounds the recommended quantity up to the pack size', () => {
    const plan = computeReorderPlan({ id: 'p5', name: 'Bougie', currentStock: 2, ...base, packSize: 5 }, [10, 10, 10])
    expect(plan.recommendedOrderQty).toBe(15) // 11 rounded up to a multiple of 5
  })

  it('adds a safety stock when demand is variable', () => {
    const steady = computeReorderPlan({ id: 'a', name: 'A', currentStock: 100, ...base }, [10, 10, 10])
    const variable = computeReorderPlan({ id: 'b', name: 'B', currentStock: 100, ...base }, [2, 18, 4, 16])
    expect(steady.safetyStock).toBe(0)
    expect(variable.safetyStock).toBeGreaterThan(0)
  })
})

describe('planReorders', () => {
  it('sorts by urgency and summarizes the order', () => {
    const report = planReorders([
      { item: { id: 'ample', name: 'Ample', currentStock: 1000, ...base }, consumption: [10, 10, 10] },
      { item: { id: 'critical', name: 'Critique', currentStock: 2, ...base }, consumption: [10, 10, 10] },
    ])
    expect(report.plans[0].id).toBe('critical') // critical first
    expect(report.summary.itemsAnalyzed).toBe(2)
    expect(report.summary.itemsToReorder).toBe(1)
    expect(report.summary.totalOrderCost).toBe(44)
  })
})

/**
 * Les deux MONTANTS de ce module passent par la couche monétaire centrale.
 *
 * `round2` (`Math.round(n * 100) / 100`) est naïf face au bruit IEEE-754 : sur
 * 1,005 € il rend 1,00 € là où `lineCents`/`toCents` rendent 1,01 €, parce que
 * la couche centrale ajoute sa tolérance APRÈS passage en centimes. Deux écrans
 * affichant le même coût estimé doivent afficher le même chiffre — c'est la
 * raison d'être de la règle « aucun calcul monétaire hors couche centrale ».
 */
describe('les montants du plan de réapprovisionnement sont exacts au centime', () => {
  const piece = (unitCost: number, currentStock = 0, minStock = 1) => ({
    item: { id: 'p1', name: 'P', currentStock, unitCost, minStock, leadTimeDays: 7, periodDays: 30 },
    consumption: [] as number[],
  })

  it('un prix à la demi-unité de centime n’est pas rogné', () => {
    // round2 : Math.round(1.005 * 100) / 100 === 1 (le produit binaire vaut
    // 100.49999999999999). La couche centrale rend 1,01 €.
    const { plans } = planReorders([piece(1.005)])
    expect(plans[0].recommendedOrderQty).toBe(1)
    expect(plans[0].estimatedCost, 'arrondi demi-éloigné-de-zéro, comme partout ailleurs').toBe(1.01)
  })

  it('le total est sommé en centimes entiers, pas en euros flottants', () => {
    // 0,10 € × 3 pièces : en flottants, 0.1+0.1+0.1 = 0.30000000000000004.
    const { summary } = planReorders([
      { ...piece(0.1), item: { ...piece(0.1).item, id: 'a' } },
      { ...piece(0.1), item: { ...piece(0.1).item, id: 'b' } },
      { ...piece(0.1), item: { ...piece(0.1).item, id: 'c' } },
    ])
    expect(summary.totalOrderCost).toBe(0.3)
  })

  it('les grandeurs NON monétaires gardent leur arrondi propre', () => {
    // La correction ne doit pas transformer des jours ou des cadences en argent.
    const { plans } = planReorders([{
      item: { id: 'p', name: 'P', currentStock: 10, unitCost: 1, minStock: 0, leadTimeDays: 7, periodDays: 30 },
      consumption: [3, 3, 3],
    }])
    expect(typeof plans[0].dailyRate).toBe('number')
    expect(plans[0].daysToStockout).not.toBeNull()
  })
})
