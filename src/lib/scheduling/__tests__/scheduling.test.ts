import { describe, it, expect } from 'vitest'
import { optimizeSchedule, type SchedJob, type SchedMechanic } from '../index'

const A: SchedMechanic = { id: 'A', name: 'Alice' }
const B: SchedMechanic = { id: 'B', name: 'Bob' }
const job = (id: string, durationMin: number, extra: Partial<SchedJob> = {}): SchedJob => ({ id, durationMin, ...extra })

describe('optimizeSchedule', () => {
  it('serializes on a single bay', () => {
    const r = optimizeSchedule([job('j1', 60), job('j2', 60)], [A, B], { bays: 1 })
    expect(r.assignments).toHaveLength(2)
    expect(r.metrics.makespan).toBe(120)
    expect(r.assignments.every((a) => a.bay === 0)).toBe(true)
  })

  it('parallelizes across two bays and balances mechanics', () => {
    const r = optimizeSchedule([job('j1', 60), job('j2', 60)], [A, B], { bays: 2 })
    expect(r.metrics.makespan).toBe(60)
    const j2 = r.assignments.find((a) => a.jobId === 'j2')!
    expect(j2.mechanicId).toBe('B') // load-balanced onto the idle mechanic
    expect(r.metrics.balanceStdDev).toBe(0)
  })

  it('respects required skills', () => {
    const r = optimizeSchedule(
      [job('j1', 60, { requiredSkill: 'elec' })],
      [{ ...A, skills: ['elec'] }, { ...B, skills: ['meca'] }],
      { bays: 2 },
    )
    expect(r.assignments[0].mechanicId).toBe('A')
  })

  it('reports no eligible mechanic when no one has the skill', () => {
    const r = optimizeSchedule(
      [job('j1', 60, { requiredSkill: 'diag' })],
      [{ ...A, skills: ['meca'] }, { ...B, skills: ['meca'] }],
    )
    expect(r.assignments).toHaveLength(0)
    expect(r.unscheduled[0].reason).toBe('no_eligible_mechanic')
  })

  it('reports no slot when the job cannot fit the day', () => {
    const r = optimizeSchedule([job('big', 700)], [A], { dayStart: 480, dayEnd: 1080 })
    expect(r.unscheduled[0].reason).toBe('no_slot')
  })

  it('schedules urgent jobs first', () => {
    const r = optimizeSchedule(
      [job('normal', 300), job('urgent', 60, { urgent: true })],
      [A],
      { bays: 1, dayStart: 480, dayEnd: 1080 },
    )
    const urgent = r.assignments.find((a) => a.jobId === 'urgent')!
    const normal = r.assignments.find((a) => a.jobId === 'normal')!
    expect(urgent.start).toBe(480)
    expect(normal.start).toBe(540)
  })

  it('excludes absent mechanics', () => {
    const r = optimizeSchedule([job('j1', 60), job('j2', 60)], [A, { ...B, absent: true }], { bays: 1 })
    expect(r.assignments.every((a) => a.mechanicId === 'A')).toBe(true)
    expect(r.metrics.loadByMechanic.map((l) => l.mechanicId)).toEqual(['A'])
  })

  it('honors availability windows', () => {
    // Alice only from 10:00 (600); the job can't start before then.
    const r = optimizeSchedule([job('j1', 60)], [{ ...A, availableFrom: 600 }], { bays: 1, dayStart: 480 })
    expect(r.assignments[0].start).toBe(600)
  })
})
