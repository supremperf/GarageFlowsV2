import { describe, it, expect } from 'vitest'
import { recommendPrice, simulateScenarios, priceForMargin, marginPctOf, estimate } from '../index'

describe('priceForMargin / marginPctOf', () => {
  it('computes price for a target margin on revenue', () => {
    expect(priceForMargin(60, 40)).toBe(100) // 60 / (1 - 0.40)
    expect(priceForMargin(60, 10)).toBe(66.67)
  })
  it('computes margin percentage of a price', () => {
    expect(marginPctOf(100, 60)).toBe(40)
    expect(marginPctOf(90, 60)).toBeCloseTo(33.3, 1)
  })
})

describe('recommendPrice', () => {
  it('recommends the target-margin price with no competitor', () => {
    const r = recommendPrice({ unitCost: 60, targetMarginPct: 40, minMarginPct: 10 })
    expect(r.recommendedPrice).toBe(100)
    expect(r.marginPct).toBe(40)
    expect(r.floorPrice).toBe(66.67)
    expect(r.targetPrice).toBe(100)
  })

  it('stays at or below an undercutting competitor', () => {
    const r = recommendPrice({ unitCost: 60, targetMarginPct: 40, competitorPrice: 90 })
    expect(r.recommendedPrice).toBe(90)
  })

  it('ignores a competitor priced above target', () => {
    const r = recommendPrice({ unitCost: 60, targetMarginPct: 40, competitorPrice: 120 })
    expect(r.recommendedPrice).toBe(100)
  })

  it('never prices below the margin floor', () => {
    const r = recommendPrice({ unitCost: 60, targetMarginPct: 5, minMarginPct: 10 })
    expect(r.recommendedPrice).toBe(66.67) // target (63.16) clamped up to floor
  })

  it('applies a seasonal factor', () => {
    const r = recommendPrice({ unitCost: 60, targetMarginPct: 40, seasonFactor: 1.1 })
    expect(r.recommendedPrice).toBe(110)
  })

  it('applies a loyalty discount', () => {
    const r = recommendPrice({ unitCost: 60, targetMarginPct: 40, loyaltyDiscountPct: 10 })
    expect(r.recommendedPrice).toBe(90) // 100 × 0.9
  })

  it('produces scenarios and a profit-max scan when a baseline is given', () => {
    const r = recommendPrice({ unitCost: 60, targetMarginPct: 40, currentPrice: 100, baselineVolume: 100, elasticity: -1.2 })
    const labels = r.scenarios.map((s) => s.label)
    expect(labels).toContain('recommandé')
    expect(labels).toContain('cible')
    expect(labels).toContain('profit_max')
    const rec = r.scenarios.find((s) => s.label === 'recommandé')!
    expect(rec.estProfit).not.toBeNull()
  })
})

describe('elasticity estimate', () => {
  it('reduces estimated volume when the price rises', () => {
    const input = { unitCost: 60, currentPrice: 100, baselineVolume: 100, elasticity: -1.5 }
    const up = estimate(input, 110)
    const down = estimate(input, 90)
    expect(up.estVolume!).toBeLessThan(100)
    expect(down.estVolume!).toBeGreaterThan(100)
  })
  it('returns nulls without a baseline', () => {
    expect(estimate({ unitCost: 60 }, 100).estVolume).toBeNull()
  })
})

describe('simulateScenarios', () => {
  it('ranks candidate prices by estimated profit', () => {
    const input = { unitCost: 60, currentPrice: 100, baselineVolume: 100, elasticity: -1.2 }
    const s = simulateScenarios(input, [70, 100, 130])
    for (let i = 1; i < s.length; i++) {
      expect(s[i - 1].estProfit!).toBeGreaterThanOrEqual(s[i].estProfit!)
    }
  })
})
