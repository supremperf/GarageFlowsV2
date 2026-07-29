import { describe, it, expect } from 'vitest'
import { buildDashboard, computeKpi, kpiStatus, deltaPct, type KpiInput, type DashboardInsight } from '../index'

describe('deltaPct', () => {
  it('computes percentage change and guards missing/zero previous', () => {
    expect(deltaPct(120, 100)).toBe(20)
    expect(deltaPct(80, 100)).toBe(-20)
    expect(deltaPct(50, 0)).toBeNull()
    expect(deltaPct(50, null)).toBeNull()
  })
})

describe('kpiStatus', () => {
  it('interprets thresholds for a higher-is-better KPI (margin %)', () => {
    const base: KpiInput = { key: 'margin', label: 'Marge', value: 25, warnAt: 20, critAt: 10, direction: 'higher_better' }
    expect(kpiStatus({ ...base, value: 25 })).toBe('good')
    expect(kpiStatus({ ...base, value: 18 })).toBe('warning')
    expect(kpiStatus({ ...base, value: 9 })).toBe('critical')
    expect(kpiStatus({ ...base, value: 20 })).toBe('warning') // boundary is inclusive
  })

  it('interprets thresholds for a lower-is-better KPI (low-stock count)', () => {
    const base: KpiInput = { key: 'lowstock', label: 'Ruptures', value: 0, warnAt: 3, critAt: 8, direction: 'lower_better' }
    expect(kpiStatus({ ...base, value: 1 })).toBe('good')
    expect(kpiStatus({ ...base, value: 5 })).toBe('warning')
    expect(kpiStatus({ ...base, value: 10 })).toBe('critical')
  })

  it('is neutral when no threshold is given', () => {
    expect(kpiStatus({ key: 'x', label: 'X', value: 42 })).toBe('neutral')
  })
})

describe('computeKpi', () => {
  it('derives trend and delta from the previous value', () => {
    const k = computeKpi({ key: 'rev', label: 'CA', value: 12000, previous: 10000, unit: '€' })
    expect(k.trend).toBe('up')
    expect(k.deltaPct).toBe(20)
    expect(k.direction).toBe('higher_better')
  })

  it('marks a flat trend when the value is unchanged', () => {
    expect(computeKpi({ key: 'x', label: 'X', value: 5, previous: 5 }).trend).toBe('flat')
  })
})

describe('buildDashboard', () => {
  const kpis: KpiInput[] = [
    { key: 'revenue', label: 'CA HT', value: 12000, previous: 10000, unit: '€', direction: 'higher_better' },
    { key: 'margin', label: 'Marge %', value: 9, previous: 22, unit: '%', warnAt: 20, critAt: 10, direction: 'higher_better' },
    { key: 'lowstock', label: 'Ruptures', value: 5, previous: 2, unit: '', warnAt: 3, critAt: 8, direction: 'lower_better' },
  ]
  const insights: DashboardInsight[] = [
    { id: 'i1', severity: 'medium', title: 'Devis en attente', message: '…', source: 'proactive' },
    { id: 'i2', severity: 'critical', title: 'Marge sous le seuil', message: '…', source: 'profitability' },
    { id: 'i3', severity: 'low', title: 'Info', message: '…', source: 'memory' },
  ]

  const dash = buildDashboard({ kpis, insights, period: { label: 'Ce mois' } })

  it('computes KPI statuses (margin critical, low-stock warning)', () => {
    const by = Object.fromEntries(dash.kpis.map((k) => [k.key, k]))
    expect(by.margin.status).toBe('critical')
    expect(by.lowstock.status).toBe('warning')
    expect(by.revenue.status).toBe('neutral')
    expect(by.revenue.trend).toBe('up')
  })

  it('sorts insights most-severe first', () => {
    expect(dash.insights.map((i) => i.id)).toEqual(['i2', 'i1', 'i3'])
  })

  it('penalises the health score by KPI statuses and insight severities', () => {
    // 100 − 20 (margin crit) − 8 (lowstock warn) − 15 (crit insight) − 3 (medium) − 1 (low) = 53
    expect(dash.healthScore).toBe(53)
    expect(dash.healthLabel).toBe('À surveiller')
  })

  it('summarises critical/warning counts', () => {
    expect(dash.summary).toEqual({ criticalKpis: 1, warningKpis: 1, criticalInsights: 1 })
  })

  it('never returns a health score outside [0,100]', () => {
    const manyCrit = buildDashboard({
      kpis: Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, label: 'K', value: 0, warnAt: 5, critAt: 1, direction: 'higher_better' as const })),
      insights: Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, severity: 'critical' as const, title: 'C', message: '', source: 's' })),
    })
    expect(manyCrit.healthScore).toBe(0)
    expect(manyCrit.healthLabel).toBe('Critique')
  })

  it('handles an empty dashboard as fully healthy', () => {
    const empty = buildDashboard({ kpis: [] })
    expect(empty.healthScore).toBe(100)
    expect(empty.healthLabel).toBe('Excellent')
    expect(empty.insights).toEqual([])
  })
})
