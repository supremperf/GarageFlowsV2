/**
 * Tests for the monitoring grading logic and collectors (src/lib/monitoring).
 */
import { describe, it, expect } from 'vitest'
import {
  statusForValue, overallStatus, gradeMetrics, collectSystemMetrics, collectProcessMetrics,
  DEFAULT_THRESHOLDS, type SystemMetrics,
} from '../metrics'

describe('statusForValue', () => {
  const t = { warn: 80, crit: 92 }
  it('grades below warn as ok', () => expect(statusForValue(50, t)).toBe('ok'))
  it('grades at/above warn as warning', () => {
    expect(statusForValue(80, t)).toBe('warning')
    expect(statusForValue(85, t)).toBe('warning')
  })
  it('grades at/above crit as critical', () => {
    expect(statusForValue(92, t)).toBe('critical')
    expect(statusForValue(100, t)).toBe('critical')
  })
})

describe('overallStatus', () => {
  it('returns the worst component status', () => {
    expect(overallStatus(['ok', 'ok'])).toBe('ok')
    expect(overallStatus(['ok', 'warning'])).toBe('warning')
    expect(overallStatus(['warning', 'critical', 'ok'])).toBe('critical')
  })
})

describe('gradeMetrics', () => {
  const system: SystemMetrics = {
    platform: 'test',
    uptimeSec: 100,
    cpu: { cores: 4, loadPct: 95, loadAvg: [3.8, 2, 1] },
    memory: { totalMB: 1000, freeMB: 500, usedMB: 500, usedPct: 50 },
    disk: { totalMB: 1000, freeMB: 850, usedMB: 150, usedPct: 15 },
  }
  it('flags a critical component and reflects it in overall', () => {
    const { statuses, overall } = gradeMetrics(system, 50, DEFAULT_THRESHOLDS)
    expect(statuses.cpu).toBe('critical') // 95 ≥ 90
    expect(statuses.memory).toBe('ok')
    expect(statuses.disk).toBe('ok')
    expect(statuses.database).toBe('ok')
    expect(overall).toBe('critical')
  })
  it('treats an unreachable database (null latency) as critical', () => {
    const { statuses, overall } = gradeMetrics({ ...system, cpu: { ...system.cpu, loadPct: 10 } }, null)
    expect(statuses.database).toBe('critical')
    expect(overall).toBe('critical')
  })
  it('omits the disk status when disk metrics are unavailable', () => {
    const { statuses } = gradeMetrics({ ...system, cpu: { ...system.cpu, loadPct: 10 }, disk: null }, 20)
    expect(statuses.disk).toBeUndefined()
  })
})

describe('collectors (real host — shape/range checks only)', () => {
  it('collectSystemMetrics returns sane values', () => {
    const m = collectSystemMetrics()
    expect(m.cpu.cores).toBeGreaterThanOrEqual(1)
    expect(m.memory.usedPct).toBeGreaterThanOrEqual(0)
    expect(m.memory.usedPct).toBeLessThanOrEqual(100)
    expect(m.uptimeSec).toBeGreaterThanOrEqual(0)
  })
  it('collectProcessMetrics reports memory + node version', () => {
    const p = collectProcessMetrics()
    expect(p.rssMB).toBeGreaterThan(0)
    expect(p.nodeVersion).toMatch(/^v\d+/)
  })
})
