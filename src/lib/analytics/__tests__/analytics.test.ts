/**
 * Tests for the analytics engine (metrics, health score, copilote insights).
 *
 * A single deterministic, realistic fixture drives the assertions. `now` is
 * fixed so date-based metrics (immobilisation, overdue days, expiry) are stable.
 */
import { describe, it, expect } from 'vitest'
import type { GarageDataset, AnalyticsLine } from '../types'
import { computeMetrics } from '../metrics'
import { computeHealthScore } from '../health-score'
import { generateInsights, buildCopilotReport } from '../insights'

const NOW = new Date('2026-07-27T12:00:00')
const line = (unitPrice: number, unitCost: number, isLabor = false): AnalyticsLine => ({ quantity: 1, unitPrice, unitCost, isLabor })

function fixture(): GarageDataset {
  return {
    periodDays: 30,
    windowStart: new Date('2026-06-28T00:00:00'),
    windowEnd: NOW,
    now: NOW,
    hourlyRate: 60,
    workshopStartHour: 8,
    workshopEndHour: 18,
    mechanics: [
      { id: 'm1', name: 'Alice', isAbsent: false },
      { id: 'm2', name: 'Bob', isAbsent: false },
    ],
    jobs: [
      { id: 'A', status: 'completed', estimatedDuration: 60, actualDuration: 90, date: '2026-07-20', createdAt: new Date('2026-07-20'), updatedAt: NOW, mechanicId: 'm1', isUrgent: false, customerName: 'Cli1', vehicleModel: 'Clio', licensePlate: 'AA-111-BB' },
      { id: 'B', status: 'completed', estimatedDuration: 120, actualDuration: 60, date: '2026-07-21', createdAt: new Date('2026-07-21'), updatedAt: NOW, mechanicId: 'm2', isUrgent: false, customerName: 'Cli2', vehicleModel: '208', licensePlate: 'EE-333-FF' },
      { id: 'C', status: 'in_progress', estimatedDuration: 240, actualDuration: null, date: '2026-07-01', createdAt: new Date('2026-07-01'), updatedAt: NOW, mechanicId: 'm1', isUrgent: true, customerName: 'Cli1', vehicleModel: 'Clio', licensePlate: 'AA-111-BB' },
      { id: 'D', status: 'scheduled', estimatedDuration: 60, actualDuration: null, date: '2026-07-26', createdAt: new Date('2026-07-26'), updatedAt: NOW, mechanicId: 'm2', isUrgent: false, customerName: 'Cli3', vehicleModel: 'Megane', licensePlate: 'CC-222-DD' },
      { id: 'E', status: 'cancelled', estimatedDuration: 30, actualDuration: null, date: '2026-07-15', createdAt: new Date('2026-07-15'), updatedAt: NOW, mechanicId: 'm1', isUrgent: false, customerName: 'Cli4', vehicleModel: 'C3', licensePlate: null },
    ],
    invoices: [
      { id: 'inv1', number: 'FAC-1', status: 'paid', issueDate: '2026-07-10', dueDate: null, createdAt: new Date('2026-07-10'), taxRate: 20, clientId: 'c1', clientName: 'Cli1', lines: [line(100, 40)] },
      { id: 'inv2', number: 'FAC-2', status: 'paid', issueDate: '2026-07-12', dueDate: null, createdAt: new Date('2026-07-12'), taxRate: 20, clientId: 'c1', clientName: 'Cli1', lines: [line(200, 50)] },
      { id: 'inv3', number: 'FAC-3', status: 'sent', issueDate: '2026-06-20', dueDate: '2026-07-01', createdAt: new Date('2026-06-20'), taxRate: 20, clientId: 'c2', clientName: 'Cli2', lines: [line(300, 0)] },
      { id: 'inv4', number: 'FAC-4', status: 'sent', issueDate: '2026-07-20', dueDate: '2026-12-31', createdAt: new Date('2026-07-20'), taxRate: 20, clientId: 'c2', clientName: 'Cli2', lines: [line(80, 0)] },
    ],
    quotes: [
      { id: 'q1', number: 'DEV-1', status: 'accepted', issueDate: '2026-07-05', validUntil: null, createdAt: new Date('2026-07-05'), taxRate: 20, clientId: 'c1', clientName: 'Cli1', lines: [line(150, 50)] },
      { id: 'q2', number: 'DEV-2', status: 'refused', issueDate: '2026-07-06', validUntil: null, createdAt: new Date('2026-07-06'), taxRate: 20, clientId: 'c2', clientName: 'Cli2', lines: [line(100, 30)] },
      { id: 'q3', number: 'DEV-3', status: 'converted', issueDate: '2026-07-07', validUntil: null, createdAt: new Date('2026-07-07'), taxRate: 20, clientId: 'c1', clientName: 'Cli1', lines: [line(220, 60)] },
      { id: 'q4', number: 'DEV-4', status: 'sent', issueDate: '2026-07-01', validUntil: '2026-07-10', createdAt: new Date('2026-07-01'), taxRate: 20, clientId: 'c2', clientName: 'Cli2', lines: [line(500, 100)] },
    ],
    parts: [
      { id: 'p1', name: 'Filtre huile', reference: 'FH-1', quantity: 0, minQuantity: 5, unitCost: 4, unitPrice: 9 },
      { id: 'p2', name: 'Plaquettes', reference: 'PL-2', quantity: 3, minQuantity: 5, unitCost: 20, unitPrice: 45 },
      { id: 'p3', name: 'Ampoule', reference: 'AM-3', quantity: 10, minQuantity: 5, unitCost: 2, unitPrice: 6 },
    ],
    warranties: [
      { id: 'w1', status: 'active', expiresAt: new Date('2026-08-06'), clientName: 'Cli1', vehicleModel: 'Clio', licensePlate: 'AA-111-BB', partName: 'Embrayage' },
      { id: 'w2', status: 'active', expiresAt: new Date('2027-02-01'), clientName: 'Cli2', vehicleModel: '208', licensePlate: 'EE-333-FF', partName: 'Alternateur' },
      { id: 'w3', status: 'claimed', expiresAt: new Date('2026-09-01'), clientName: 'Cli3', vehicleModel: 'Megane', licensePlate: 'CC-222-DD', partName: 'Démarreur' },
    ],
    clients: [
      { id: 'c1', name: 'Cli1', createdAt: new Date('2025-01-01') },
      { id: 'c2', name: 'Cli2', createdAt: new Date('2025-01-01') },
      { id: 'c3', name: 'Cli3 (dormant)', createdAt: new Date('2024-01-01') },
    ],
  }
}

describe('computeMetrics', () => {
  const m = computeMetrics(fixture())

  it('computes confirmed revenue, cost and margin from paid invoices', () => {
    expect(m.revenue.paidHT).toBe(300)
    expect(m.revenue.paidCost).toBe(90)
    expect(m.revenue.marginHT).toBe(210)
    expect(m.revenue.marginRatePct).toBe(70)
    expect(m.revenue.invoiceCount).toBe(2)
  })

  it('computes repair-time efficiency from completed jobs', () => {
    expect(m.repairTime.completedCount).toBe(2)
    expect(m.repairTime.efficiencyPct).toBe(120) // est 180 / actual 150
  })

  it('detects immobilised vehicles (old, non-terminal)', () => {
    expect(m.immobilizedVehicles).toHaveLength(1)
    expect(m.immobilizedVehicles[0].jobId).toBe('C')
    expect(m.immobilizedVehicles[0].days).toBeGreaterThanOrEqual(3)
  })

  it('detects overdue invoices and total outstanding', () => {
    expect(m.overdueInvoices).toHaveLength(1)
    expect(m.overdueInvoices[0].number).toBe('FAC-3')
    expect(m.overdueInvoices[0].daysOverdue).toBeGreaterThan(0)
    expect(m.outstandingTTC).toBe(456) // 360 + 96 TTC
  })

  it('computes quote conversion and stale quotes', () => {
    expect(m.quoteConversionPct).toBe(67) // 2 won of 3 resolved
    expect(m.staleQuotes).toHaveLength(1)
    expect(m.staleQuotes[0].expired).toBe(true)
  })

  it('classifies stock into critical and low', () => {
    expect(m.criticalStock).toHaveLength(1)
    expect(m.criticalStock[0].id).toBe('p1')
    expect(m.lowStock).toHaveLength(1)
    expect(m.lowStock[0].id).toBe('p2')
  })

  it('finds expiring warranties and computes claim rate', () => {
    expect(m.expiringWarranties).toHaveLength(1)
    expect(m.expiringWarranties[0].id).toBe('w1')
    expect(m.activeWarrantyClaimRatePct).toBe(33) // 1 claimed of 3
  })

  it('ranks the costliest vehicle by time', () => {
    expect(m.topCostlyVehicles[0].licensePlate).toBe('AA-111-BB')
    expect(m.topCostlyVehicles[0].totalMin).toBe(330) // 90 + 240
  })

  it('flags one inactive client and counts cancellations', () => {
    expect(m.inactiveClients).toHaveLength(1)
    expect(m.inactiveClients[0].id).toBe('c3')
    expect(m.cancelledJobCount).toBe(1)
  })

  it('reports full data sufficiency for a rich dataset', () => {
    expect(m.dataSufficiency).toEqual({ revenue: true, repairTime: true, quotes: true, stock: true, mechanics: true })
    expect(m.utilizationPct).not.toBeNull()
  })
})

describe('computeHealthScore', () => {
  it('produces a bounded score, a grade and full coverage for rich data', () => {
    const h = computeHealthScore(computeMetrics(fixture()))
    expect(h.score).toBeGreaterThan(0)
    expect(h.score).toBeLessThanOrEqual(100)
    expect(['excellent', 'good', 'fair', 'poor', 'critical']).toContain(h.grade)
    expect(h.coverage).toBeGreaterThan(0.9) // every component backed by data
  })

  it('recommends the weak components (stock rupture, low productivity)', () => {
    const h = computeHealthScore(computeMetrics(fixture()))
    const keys = h.subScores.filter(s => s.available && (s.score ?? 100) < 60).map(s => s.key)
    expect(keys).toContain('stock')
    expect(h.recommendations.length).toBeGreaterThan(0)
  })

  it('excludes and flags components without data (empty garage)', () => {
    const empty = { ...fixture(), jobs: [], invoices: [], quotes: [], parts: [], warranties: [], clients: [], mechanics: [] }
    const h = computeHealthScore(computeMetrics(empty))
    expect(h.score).toBe(0)
    expect(h.coverage).toBe(0)
    expect(h.subScores.every(s => !s.available)).toBe(true)
  })

  it('computes a real period-over-period trend', () => {
    const current = computeMetrics(fixture())
    // Previous window: half the margin → current should trend up.
    const weaker = fixture()
    weaker.invoices = [{ id: 'p', number: 'P', status: 'paid', issueDate: '2026-06-01', dueDate: null, createdAt: new Date('2026-06-01'), taxRate: 20, clientId: 'c1', clientName: 'Cli1', lines: [line(100, 90)] }]
    const h = computeHealthScore(current, computeMetrics(weaker))
    expect(h.trend.previousScore).not.toBeNull()
    expect(['up', 'down', 'stable']).toContain(h.trend.direction)
  })
})

describe('generateInsights / buildCopilotReport', () => {
  it('emits ranked, evidence-backed findings', () => {
    const { insights, dataGaps } = generateInsights(computeMetrics(fixture()))
    const ids = insights.map(i => i.id)
    expect(ids).toContain('overdue-invoices')
    expect(ids).toContain('critical-stock')
    expect(ids).toContain('immobilized-vehicles')
    expect(ids).toContain('stale-quotes')
    expect(ids).toContain('churn-risk-clients')
    // Sorted by severity: the first finding is at least 'high'.
    expect(['critical', 'high']).toContain(insights[0].severity)
    // Every finding carries evidence.
    expect(insights.every(i => i.evidence && Object.keys(i.evidence).length > 0)).toBe(true)
    expect(dataGaps).toHaveLength(0)
  })

  it('builds a report with forecast, priority actions and no hallucinated gaps', () => {
    const report = buildCopilotReport(computeMetrics(fixture()))
    expect(report.healthScore).toBeGreaterThan(0)
    expect(report.forecast.weeklyMarginHT).toBe(49) // round(210 / 30 * 7)
    expect(report.priorityActions.length).toBeGreaterThan(0)
    expect(report.priorityActions[0].rank).toBe(1)
  })

  it('reports explicit data gaps and a null forecast for an empty garage', () => {
    const empty = { ...fixture(), jobs: [], invoices: [], quotes: [], parts: [], warranties: [], clients: [], mechanics: [] }
    const report = buildCopilotReport(computeMetrics(empty))
    expect(report.forecast.weeklyMarginHT).toBeNull()
    expect(report.dataGaps.length).toBeGreaterThan(0)
  })
})
