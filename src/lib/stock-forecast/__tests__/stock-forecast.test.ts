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
