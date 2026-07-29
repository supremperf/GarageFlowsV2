import { describe, it, expect } from 'vitest'
import {
  lineMargin,
  invoiceMargin,
  byDimension,
  marginByPart,
  detectDormantStock,
  analyze,
  type AnalyzedInvoice,
  type AnalyzedJobPart,
  type PartStock,
} from '../index'

const invoices: AnalyzedInvoice[] = [
  { id: 'a', number: 'FAC-1', status: 'paid', clientId: 'c1', clientName: 'Alice', make: 'Renault', mechanicId: 'm1', mechanicName: 'Karim', lines: [{ description: 'x', quantity: 1, unitPrice: 100, unitCost: 60 }] },
  { id: 'b', number: 'FAC-2', status: 'paid', clientId: 'c1', clientName: 'Alice', make: 'Renault', mechanicId: 'm1', mechanicName: 'Karim', lines: [{ description: 'y', quantity: 1, unitPrice: 100, unitCost: 95 }] },
  { id: 'c', number: 'FAC-3', status: 'paid', clientId: 'c2', clientName: 'Bob', make: 'Peugeot', mechanicId: 'm2', mechanicName: 'Léa', lines: [{ description: 'z', quantity: 1, unitPrice: 50, unitCost: 80 }] },
]

const jobParts: AnalyzedJobPart[] = [
  { partId: 'p1', partName: 'Filtre', quantity: 2, unitPrice: 10, unitCost: 6 },
  { partId: 'p2', partName: 'Bougie', quantity: 1, unitPrice: 5, unitCost: 8 },
]

const parts: PartStock[] = [
  { id: 'p1', name: 'Filtre', quantity: 5, unitCost: 6, unitPrice: 10 },
  { id: 'p3', name: 'Durite dormante', quantity: 30, unitCost: 5, unitPrice: 12 },
]

describe('margin primitives', () => {
  it('computes line margin and percentage', () => {
    expect(lineMargin({ quantity: 2, unitPrice: 50, unitCost: 30 })).toEqual({
      revenueHT: 100, costHT: 60, margin: 40, marginPct: 40,
    })
  })
  it('computes invoice margin over lines', () => {
    expect(invoiceMargin(invoices[0])).toMatchObject({ revenueHT: 100, costHT: 60, margin: 40, marginPct: 40 })
  })
})

describe('byDimension', () => {
  it('aggregates by client', () => {
    const byClient = byDimension(invoices, (i) => (i.clientId ? { key: i.clientId, label: i.clientName ?? '' } : null))
    const alice = byClient.find((d) => d.key === 'c1')!
    const bob = byClient.find((d) => d.key === 'c2')!
    expect(alice.margin).toBe(45) // 40 + 5
    expect(alice.count).toBe(2)
    expect(bob.margin).toBe(-30)
  })
})

describe('marginByPart', () => {
  it('aggregates per part and flags loss', () => {
    const m = marginByPart(jobParts)
    expect(m.find((p) => p.partId === 'p1')!.margin).toBe(8) // (20-12)
    expect(m.find((p) => p.partId === 'p2')!.margin).toBe(-3)
  })
})

describe('detectDormantStock', () => {
  it('flags stocked parts with no sales, valued at cost', () => {
    const sold = new Set(['p1', 'p2'])
    const dormant = detectDormantStock(parts, sold)
    expect(dormant).toHaveLength(1)
    expect(dormant[0].ref?.id).toBe('p3')
    expect(dormant[0].amount).toBe(150) // 30 * 5
    expect(dormant[0].severity).toBe('medium')
  })
})

describe('analyze (full report)', () => {
  const report = analyze({ invoices, jobParts, parts })

  it('computes correct totals', () => {
    expect(report.totals.revenueHT).toBe(250)
    expect(report.totals.costHT).toBe(235)
    expect(report.totals.margin).toBe(15)
    expect(report.totals.invoiceCount).toBe(3)
  })

  it('surfaces every anomaly class', () => {
    const types = new Set(report.anomalies.map((a) => a.type))
    expect(types).toContain('dormant_stock')
    expect(types).toContain('negative_margin_invoice')
    expect(types).toContain('low_margin_invoice')
    expect(types).toContain('deficit_client')
    expect(types).toContain('negative_margin_part')
  })

  it('produces concrete recommendations', () => {
    expect(report.recommendations.length).toBeGreaterThanOrEqual(3)
    expect(report.recommendations.join(' ')).toMatch(/dormante/)
  })

  it('sorts anomalies by amount at stake (desc)', () => {
    for (let i = 1; i < report.anomalies.length; i++) {
      expect(report.anomalies[i - 1].amount).toBeGreaterThanOrEqual(report.anomalies[i].amount)
    }
  })
})

describe('empty input', () => {
  it('returns zeros and no anomalies', () => {
    const r = analyze({ invoices: [] })
    expect(r.totals.margin).toBe(0)
    expect(r.totals.marginPct).toBeNull()
    expect(r.anomalies).toHaveLength(0)
    expect(r.recommendations).toHaveLength(0)
  })
})
