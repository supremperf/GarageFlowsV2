import { describe, it, expect } from 'vitest'
import { buildAlerts, type ProactiveInput } from '../index'

describe('buildAlerts', () => {
  it('raises a critical stock alert and skips non-urgent stock', () => {
    const input: ProactiveInput = {
      stock: [
        { name: 'Huile 5W30', urgency: 'critical', daysToStockout: 4, recommendedOrderQty: 20, estimatedCost: 180, ref: 'p1' },
        { name: 'Vis', urgency: 'low', daysToStockout: 300, recommendedOrderQty: 0 },
      ],
    }
    const alerts = buildAlerts(input)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].type).toBe('stock_out_soon')
    expect(alerts[0].severity).toBe('critical')
    expect(alerts[0].message).toMatch(/4 jour/)
    expect(alerts[0].amount).toBe(180)
  })

  it('applies the pending-quote age threshold', () => {
    const alerts = buildAlerts({
      quotes: [
        { number: 'DEV-1', clientName: 'A', ageDays: 6, amount: 1500 },
        { number: 'DEV-2', clientName: 'B', ageDays: 2, amount: 800 },
      ],
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe('high') // amount ≥ 1000
    expect(alerts[0].type).toBe('quote_pending')
  })

  it('flags overload only at ≥100% (critical ≥130%)', () => {
    const alerts = buildAlerts({
      overload: [
        { name: 'Karim', utilizationPct: 140, date: '2026-08-01' },
        { name: 'Léa', utilizationPct: 90, date: '2026-08-01' },
      ],
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe('critical')
  })

  it('rates overdue invoices and CT by age', () => {
    const alerts = buildAlerts({
      overdue: [{ number: 'FAC-9', clientName: 'C', amount: 500, overdueDays: 40 }],
      ct: [{ plate: 'AB-123-CD', daysLeft: 0 }, { plate: 'EF-456-GH', daysLeft: 20 }],
    })
    expect(alerts.find((a) => a.type === 'invoice_overdue')!.severity).toBe('critical')
    expect(alerts.find((a) => a.ref?.label === 'AB-123-CD')!.severity).toBe('critical')
    expect(alerts.find((a) => a.ref?.label === 'EF-456-GH')!.severity).toBe('medium')
  })

  it('recalls only inactive high-value VIPs', () => {
    const alerts = buildAlerts({
      vip: [
        { name: 'Riche', lastVisitDays: 200, totalSpent: 3000 },
        { name: 'Petit', lastVisitDays: 200, totalSpent: 300 },
        { name: 'Récent', lastVisitDays: 30, totalSpent: 5000 },
      ],
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].ref?.label).toBe('Riche')
  })

  it('sorts by severity then money at stake', () => {
    const alerts = buildAlerts({
      quotes: [{ number: 'DEV-1', clientName: 'A', ageDays: 10, amount: 500 }], // medium
      overdue: [{ number: 'FAC-1', clientName: 'B', amount: 200, overdueDays: 40 }], // critical
      stock: [{ name: 'X', urgency: 'high', daysToStockout: 3, recommendedOrderQty: 5, estimatedCost: 50 }], // high
    })
    expect(alerts.map((a) => a.severity)).toEqual(['critical', 'high', 'medium'])
  })
})
