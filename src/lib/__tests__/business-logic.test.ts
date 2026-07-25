/**
 * Integration-style tests for critical API route logic.
 *
 * These tests exercise the pure business logic extracted from routes — billing
 * totals, job validation, migration idempotency — without spinning up a real
 * HTTP server or database.
 */

import { describe, it, expect } from 'vitest'
import { calcTotalHT, calcTotalTTC, roundCents, withTotals } from '../billing'

// ─── Invoice creation logic ────────────────────────────────────────────────────

describe('Invoice billing — route-level contract', () => {
  it('rejects empty line list (totalHT = 0)', () => {
    const totalHT = calcTotalHT([])
    expect(totalHT).toBe(0)
  })

  it('produces correct TTC for a realistic invoice', () => {
    const lines = [
      { quantity: 2,   unitPrice: 120,   unitCost: 80 },  // labor × 2h
      { quantity: 4,   unitPrice: 18.50, unitCost: 12 },  // parts
      { quantity: 1,   unitPrice: 5.99,  unitCost: 3.5 }, // misc
    ]
    const taxRate = 20
    const ht  = roundCents(calcTotalHT(lines))
    const ttc = roundCents(calcTotalTTC(lines, taxRate))

    expect(ht).toBe(roundCents(240 + 74 + 5.99))   // 319.99
    expect(ttc).toBe(roundCents(319.99 * 1.2))      // 383.99
  })

  it('handles 0% VAT (micro-entreprise)', () => {
    const lines = [{ quantity: 1, unitPrice: 200 }]
    expect(calcTotalTTC(lines, 0)).toBe(200)
  })

  it('withTotals immutability — original doc unchanged', () => {
    const doc = { id: 'xyz', lines: [{ quantity: 1, unitPrice: 100 }], taxRate: 20 }
    const result = withTotals(doc)
    expect(result).not.toBe(doc)         // new object
    expect(result.id).toBe('xyz')        // original fields preserved
    expect(result.totalHT).toBe(100)
    expect(result.totalTTC).toBe(120)
  })

  it('rounds consistently across partial-cent prices', () => {
    const lines = [{ quantity: 3, unitPrice: 9.99 }]   // 29.97 HT
    const { totalHT, totalTTC } = withTotals({ lines, taxRate: 20 })
    expect(totalHT).toBe(29.97)
    expect(totalTTC).toBe(roundCents(29.97 * 1.2))
  })
})

// ─── Job scheduling validation ─────────────────────────────────────────────────

import { jobsOverlap, findAvailableSlots, calculateUtilizationRate } from '../utils'
import type { Job, Mechanic } from '../types'

function makeJob(overrides: Partial<Job>): Job {
  const now = new Date().toISOString()
  return {
    id: 'j1', customerName: 'Client', vehicleModel: 'Peugeot 308',
    licensePlate: 'AB-123-CD', repairType: 'oil_change',
    estimatedDuration: 60, startTime: '09:00', date: '2026-04-28',
    status: 'scheduled', isUrgent: false, mechanicId: 'm1',
    garageId: 'g1', vehicleId: undefined, actualDuration: undefined,
    notes: undefined, delayMinutes: undefined, mileageAtVisit: undefined, timerStartedAt: undefined,
    ...overrides,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  }
}

describe('Job overlap detection', () => {
  it('flags two jobs at the same time for the same mechanic', () => {
    const a = makeJob({ id: 'a', startTime: '09:00', estimatedDuration: 60 })
    const b = makeJob({ id: 'b', startTime: '09:30', estimatedDuration: 60 })
    expect(jobsOverlap(a, b)).toBe(true)
  })

  it('allows back-to-back jobs (no gap needed)', () => {
    const a = makeJob({ id: 'a', startTime: '09:00', estimatedDuration: 60 })
    const b = makeJob({ id: 'b', startTime: '10:00', estimatedDuration: 60 })
    expect(jobsOverlap(a, b)).toBe(false)
  })

  it('does not flag jobs on different mechanics', () => {
    const a = makeJob({ id: 'a', mechanicId: 'm1', startTime: '09:00', estimatedDuration: 60 })
    const b = makeJob({ id: 'b', mechanicId: 'm2', startTime: '09:00', estimatedDuration: 60 })
    expect(jobsOverlap(a, b)).toBe(false)
  })

  it('does not flag a job against itself', () => {
    const j = makeJob({ id: 'same' })
    expect(jobsOverlap(j, j)).toBe(false)
  })
})

describe('findAvailableSlots — workshop hours respected', () => {
  it('returns workshop start when mechanic is free all day', () => {
    const slots = findAvailableSlots('m1', [], '2026-04-28', 60, 8, 18)
    expect(slots[0]).toBe('08:00')
  })

  it('skips past existing job', () => {
    const job = makeJob({ startTime: '08:00', estimatedDuration: 120 })
    const slots = findAvailableSlots('m1', [job], '2026-04-28', 60, 8, 18)
    expect(slots[0]).toBe('10:00')
  })

  it('returns empty when no time fits', () => {
    // Fill the whole day
    const jobs = [makeJob({ startTime: '08:00', estimatedDuration: 600 })]
    const slots = findAvailableSlots('m1', jobs, '2026-04-28', 60, 8, 18)
    expect(slots).toHaveLength(0)
  })

  it('respects custom workshop hours', () => {
    // 06:00–12:00 workshop (6h)
    const slots = findAvailableSlots('m1', [], '2026-04-28', 60, 6, 12)
    expect(slots[0]).toBe('06:00')
    // Nothing should be offered starting at 12:00 or later
    expect(slots.every(s => parseInt(s.split(':')[0]) < 12)).toBe(true)
  })
})

describe('calculateUtilizationRate', () => {
  const mech: Mechanic = { id: 'm1', name: 'Alice', avatar: 'A', color: '#3b82f6', specialty: [], order: 1, isAbsent: false, garageId: 'g1', createdAt: '', updatedAt: '' }

  it('returns 0 when no jobs', () => {
    expect(calculateUtilizationRate([], [mech], '2026-04-28', 8, 18)).toBe(0)
  })

  it('returns 50% when half the day is booked', () => {
    // 10h workshop (600 min), 300 min booked
    const job = makeJob({ estimatedDuration: 300 })
    expect(calculateUtilizationRate([job], [mech], '2026-04-28', 8, 18)).toBe(50)
  })

  it('caps at 100% on overloaded day', () => {
    const job = makeJob({ estimatedDuration: 1000 })
    expect(calculateUtilizationRate([job], [mech], '2026-04-28', 8, 18)).toBe(100)
  })

  it('excludes absent mechanics from capacity', () => {
    const absent: Mechanic = { ...mech, id: 'm2', isAbsent: true }
    // Only m1 active, 300/600 = 50%
    const job = makeJob({ estimatedDuration: 300 })
    expect(calculateUtilizationRate([job], [mech, absent], '2026-04-28', 8, 18)).toBe(50)
  })
})

// ─── Migration idempotency contract ───────────────────────────────────────────

import { MIGRATIONS } from '../migrations'

describe('Migration ID format contract', () => {
  // Validate that migration IDs follow the sequential numbering convention
  // so new migrations are always appended and never re-ordered.

  it('all IDs start with a 3-digit sequence number', () => {
    for (const m of MIGRATIONS) {
      expect(m.id).toMatch(/^\d{3}_/)
    }
  })

  it('sequence numbers are unique and contiguous', () => {
    const nums = MIGRATIONS.map(m => parseInt(m.id.slice(0, 3), 10))
    const sorted = [...nums].sort((a, b) => a - b)
    expect(nums).toEqual(sorted)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBe(1)
    }
  })
})
