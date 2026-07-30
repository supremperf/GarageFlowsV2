import { describe, it, expect } from 'vitest'
import { ForgottenPartsEngine, forgottenPartsEngine } from '../index'

describe('ForgottenPartsEngine', () => {
  it('recommends the oil filter for a vidange (with justification + confidence)', () => {
    const recs = forgottenPartsEngine.analyze({ operations: ['Vidange moteur'] })
    const filter = recs.find((r) => r.name === 'Filtre à huile')
    expect(filter).toBeDefined()
    expect(filter!.confidence).toBe('high') // baseConfidence 0.9
    expect(filter!.justification).toMatch(/vidange/i)
    expect(filter!.triggeredBy).toContain('Vidange moteur')
  })

  it('recommends the water pump for a timing-belt job', () => {
    const recs = forgottenPartsEngine.analyze({ operations: ['Remplacement courroie de distribution'] })
    const names = recs.map((r) => r.name)
    expect(names).toContain('Pompe à eau')
    expect(names).toContain('Galet tendeur')
  })

  it('is accent- and case-insensitive when matching operations', () => {
    const recs = forgottenPartsEngine.analyze({ operations: ['Changement ÉTRIER avant'] })
    expect(recs.some((r) => r.name === 'Liquide de frein')).toBe(true)
  })

  it('does not re-recommend parts already on the job', () => {
    const recs = forgottenPartsEngine.analyze({
      operations: ['Distribution'],
      partsOnJob: [{ name: 'Pompe à eau' }],
    })
    expect(recs.some((r) => r.name === 'Pompe à eau')).toBe(false)
    expect(recs.some((r) => r.name === 'Galet tendeur')).toBe(true)
  })

  it('computes a financial impact from the catalog', () => {
    const catalog = new Map<string, number>([['filtre à huile', 8.9]])
    const recs = forgottenPartsEngine.analyze({ operations: ['Vidange'], catalog })
    const filter = recs.find((r) => r.name === 'Filtre à huile')!
    expect(filter.estimatedImpact.unitPrice).toBe(8.9)
    expect(filter.estimatedImpact.total).toBe(8.9)
  })

  it('multiplies the impact by the recommended quantity (tires → 4 valves)', () => {
    const catalog = new Map<string, number>([['valves', 2.5]])
    const recs = forgottenPartsEngine.analyze({ operations: ['Montage pneus'], catalog })
    const valves = recs.find((r) => r.name === 'Valves')!
    expect(valves.estimatedImpact.qty).toBe(4)
    expect(valves.estimatedImpact.total).toBe(10)
  })

  it('boosts confidence for a garage habit', () => {
    const base = forgottenPartsEngine.analyze({ operations: ['Freins'] })
    const boosted = forgottenPartsEngine.analyze({ operations: ['Freins'], garageHabits: ['Capteur d\'usure de plaquettes'] })
    const b0 = base.find((r) => r.name === "Capteur d'usure de plaquettes")!
    const b1 = boosted.find((r) => r.name === "Capteur d'usure de plaquettes")!
    expect(b1.score).toBeGreaterThan(b0.score)
    expect(b1.justification).toMatch(/habituellement/)
  })

  it('returns nothing for unrelated operations', () => {
    expect(forgottenPartsEngine.analyze({ operations: ['Diagnostic électronique'] })).toHaveLength(0)
  })

  it('ranks higher-confidence recommendations first', () => {
    const recs = forgottenPartsEngine.analyze({ operations: ['Vidange'] })
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score)
    }
  })

  it('supports a custom rule set', () => {
    const engine = new ForgottenPartsEngine([
      { id: 'x', match: ['test'], recommends: [{ name: 'Widget', category: 'consumable', baseConfidence: 0.6, reason: 'r' }] },
    ])
    const recs = engine.analyze({ operations: ['test op'] })
    expect(recs).toHaveLength(1)
    expect(recs[0].name).toBe('Widget')
  })
})
