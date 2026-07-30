import { describe, it, expect } from 'vitest'
import { timeToMinutes, minutesToTime, jobsOverlap, calculateUtilizationRate } from '../utils'
import type { Job, Mechanic } from '../types'

// ─── timeToMinutes ────────────────────────────────────────────────────────────

describe('timeToMinutes', () => {
  it('converts midnight', () => expect(timeToMinutes('00:00')).toBe(0))
  it('converts 08:00',   () => expect(timeToMinutes('08:00')).toBe(480))
  it('converts 12:30',   () => expect(timeToMinutes('12:30')).toBe(750))
  it('converts 23:59',   () => expect(timeToMinutes('23:59')).toBe(1439))
})

// ─── minutesToTime ────────────────────────────────────────────────────────────

describe('minutesToTime', () => {
  it('formats 0',    () => expect(minutesToTime(0)).toBe('00:00'))
  it('formats 480',  () => expect(minutesToTime(480)).toBe('08:00'))
  it('formats 750',  () => expect(minutesToTime(750)).toBe('12:30'))
  it('formats 1439', () => expect(minutesToTime(1439)).toBe('23:59'))
  it('is inverse of timeToMinutes', () => {
    const times = ['08:00', '09:15', '17:45', '23:00']
    times.forEach(t => expect(minutesToTime(timeToMinutes(t))).toBe(t))
  })
})

// ─── jobsOverlap ──────────────────────────────────────────────────────────────

const base: Partial<Job> = {
  mechanicId:        'm1',
  date:              '2025-01-01',
  status:            'scheduled',
  estimatedDuration: 60,
}

function makeJob(id: string, startTime: string, duration = 60, mechanicId = 'm1', date = '2025-01-01'): Job {
  return { ...base, id, startTime, estimatedDuration: duration, mechanicId, date } as Job
}

describe('jobsOverlap', () => {
  it('returns false for same job id', () => {
    const j = makeJob('j1', '08:00')
    expect(jobsOverlap(j, j)).toBe(false)
  })

  it('detects direct overlap (one starts inside the other)', () => {
    const a = makeJob('j1', '08:00', 60)  // 08:00–09:00
    const b = makeJob('j2', '08:30', 60)  // 08:30–09:30
    expect(jobsOverlap(a, b)).toBe(true)
    expect(jobsOverlap(b, a)).toBe(true)
  })

  it('detects full containment', () => {
    const a = makeJob('j1', '08:00', 120)  // 08:00–10:00
    const b = makeJob('j2', '08:30',  30)  // 08:30–09:00
    expect(jobsOverlap(a, b)).toBe(true)
  })

  it('returns false for adjacent (back-to-back) jobs', () => {
    const a = makeJob('j1', '08:00', 60)  // 08:00–09:00
    const b = makeJob('j2', '09:00', 60)  // 09:00–10:00
    expect(jobsOverlap(a, b)).toBe(false)
  })

  it('returns false for different mechanics', () => {
    const a = makeJob('j1', '08:00', 60, 'm1')
    const b = makeJob('j2', '08:30', 60, 'm2')
    expect(jobsOverlap(a, b)).toBe(false)
  })

  it('returns false for different dates', () => {
    const a = makeJob('j1', '08:00', 60, 'm1', '2025-01-01')
    const b = makeJob('j2', '08:30', 60, 'm1', '2025-01-02')
    expect(jobsOverlap(a, b)).toBe(false)
  })

  it('returns false for non-overlapping jobs on same mechanic', () => {
    const a = makeJob('j1', '08:00', 60)  // 08:00–09:00
    const b = makeJob('j2', '10:00', 60)  // 10:00–11:00
    expect(jobsOverlap(a, b)).toBe(false)
  })

  it('detects overlap caused by delayMinutes (regression)', () => {
    // Without delayMinutes the two would be back-to-back (no overlap); the delay
    // pushes j1 to 09:30, overlapping j2 (09:00–10:00).
    const a = { ...makeJob('j1', '08:00', 60), delayMinutes: 30 } as Job // 08:00–09:30
    const b = makeJob('j2', '09:00', 60)                                  // 09:00–10:00
    expect(jobsOverlap(a, b)).toBe(true)
    expect(jobsOverlap(b, a)).toBe(true)
  })
})

// ─── calculateUtilizationRate ─────────────────────────────────────────────────

describe('calculateUtilizationRate', () => {
  const mechanic: Mechanic = { id: 'm1', name: 'Alice', isAbsent: false } as Mechanic

  it('returns 0 when no mechanics', () => {
    expect(calculateUtilizationRate([], [], '2025-01-01')).toBe(0)
  })

  it('returns 0 when no jobs', () => {
    expect(calculateUtilizationRate([], [mechanic], '2025-01-01')).toBe(0)
  })

  it('calculates correct utilization (50% of 10h day = 300min)', () => {
    // WORKSHOP_START_HOUR=8, WORKSHOP_END_HOUR=18 → 600min capacity
    const job = makeJob('j1', '08:00', 300)
    const rate = calculateUtilizationRate([job], [mechanic], '2025-01-01')
    expect(rate).toBe(50)
  })

  it('caps at 100%', () => {
    const job = makeJob('j1', '08:00', 9999)
    const rate = calculateUtilizationRate([job], [mechanic], '2025-01-01')
    expect(rate).toBe(100)
  })

  it('excludes cancelled jobs', () => {
    const job = { ...makeJob('j1', '08:00', 600), status: 'cancelled' } as Job
    const rate = calculateUtilizationRate([job], [mechanic], '2025-01-01')
    expect(rate).toBe(0)
  })

  it('excludes absent mechanics from capacity', () => {
    const absent: Mechanic = { id: 'm2', name: 'Bob', isAbsent: true } as Mechanic
    // With one absent mechanic, capacity is still 600min (only active ones count)
    const job = makeJob('j1', '08:00', 300)
    const rate = calculateUtilizationRate([job], [mechanic, absent], '2025-01-01')
    expect(rate).toBe(50)
  })
})
