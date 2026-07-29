import { describe, it, expect } from 'vitest'
import { analyzeMemory, type InterventionRecord } from '../index'

const records: InterventionRecord[] = [
  { id: '1', date: '2026-01-01', vehiclePlate: 'AA-1', repairType: 'freins', mechanicName: 'Karim', actualMinutes: 60, parts: [{ reference: 'BRK1', name: 'Plaquettes' }] },
  { id: '2', date: '2026-02-01', vehiclePlate: 'AA-1', repairType: 'freins', mechanicName: 'Karim', actualMinutes: 60, parts: [{ reference: 'BRK1', name: 'Plaquettes' }] },
  { id: '3', date: '2026-03-01', vehiclePlate: 'AA-1', repairType: 'freins', mechanicName: 'Léa', actualMinutes: 60 },
  { id: '4', date: '2026-01-05', vehiclePlate: 'BB-2', repairType: 'vidange', mechanicName: 'Karim', actualMinutes: 30 },
  { id: '5', date: '2026-01-06', vehiclePlate: 'CC-3', repairType: 'vidange', mechanicName: 'Karim', actualMinutes: 30 },
  { id: '6', date: '2026-01-07', vehiclePlate: 'DD-4', repairType: 'vidange', mechanicName: 'Léa', actualMinutes: 60 },
  { id: '7', date: '2026-01-08', vehiclePlate: 'EE-5', repairType: 'diag', mechanicName: 'Karim', actualMinutes: 45, satisfaction: 2 },
  { id: '8', date: '2026-01-09', vehiclePlate: 'FF-6', repairType: 'diag', mechanicName: 'Léa', actualMinutes: 45, satisfaction: 2 },
]

describe('analyzeMemory', () => {
  const { insights, summary } = analyzeMemory(records)
  const byType = (t: string) => insights.filter((i) => i.type === t)

  it('detects a recurring fault on a vehicle', () => {
    const rec = byType('recurring_fault').find((i) => i.ref?.plate === 'AA-1')!
    expect(rec).toBeDefined()
    expect(rec.metric?.count).toBe(3)
    expect(rec.severity).toBe('high')
    expect(rec.message).toMatch(/3 fois/)
  })

  it('flags a frequent vehicle', () => {
    expect(byType('frequent_vehicle').some((i) => i.ref?.plate === 'AA-1')).toBe(true)
  })

  it('flags a part refitted on the same vehicle', () => {
    const p = byType('part_reliability').find((i) => i.ref?.partRef === 'BRK1')!
    expect(p).toBeDefined()
    expect(p.metric?.repeat).toBe(2)
  })

  it('surfaces a faster repair method', () => {
    const s = byType('repair_speed').find((i) => i.ref?.repairType === 'vidange')!
    expect(s).toBeDefined()
    expect(s.ref?.mechanicName).toBe('Karim')
    expect(s.metric?.mechAvg).toBe(30)
    expect(s.metric?.typeAvg).toBe(40)
  })

  it('flags low satisfaction on a repair type', () => {
    const l = byType('low_satisfaction').find((i) => i.ref?.repairType === 'diag')!
    expect(l).toBeDefined()
    expect(l.metric?.avg).toBe(2)
  })

  it('summarizes the dataset and sorts by severity', () => {
    expect(summary.interventions).toBe(8)
    expect(summary.vehicles).toBe(6)
    expect(summary.repairTypes).toBe(3)
    for (let i = 1; i < insights.length; i++) {
      const rank = { high: 0, medium: 1, low: 2 } as const
      expect(rank[insights[i - 1].severity]).toBeLessThanOrEqual(rank[insights[i].severity])
    }
  })

  it('returns no insights for a single isolated visit', () => {
    const r = analyzeMemory([{ id: 'x', date: '2026-01-01', vehiclePlate: 'ZZ-9', repairType: 'freins' }])
    expect(r.insights).toHaveLength(0)
  })
})
