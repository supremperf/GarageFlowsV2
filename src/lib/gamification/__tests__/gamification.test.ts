import { describe, it, expect } from 'vitest'
import { buildProfile, buildLeaderboard, levelInfo, xpForLevel, type MechanicStats } from '../index'

const alice: MechanicStats = {
  id: 'a', name: 'Alice', jobsCompleted: 10, estimatedMinutes: 600, actualMinutes: 500,
  onTimeJobs: 9, reworkJobs: 1, satisfactionSum: 45, satisfactionCount: 10, revenueHT: 5000,
}
const bob: MechanicStats = {
  id: 'b', name: 'Bob', jobsCompleted: 100, estimatedMinutes: 1000, actualMinutes: 800,
  onTimeJobs: 100, reworkJobs: 0, satisfactionSum: 500, satisfactionCount: 100, revenueHT: 0,
}
const cleo: MechanicStats = {
  id: 'c', name: 'Cléo', jobsCompleted: 5, estimatedMinutes: 300, actualMinutes: 300,
  onTimeJobs: 5, reworkJobs: 0, satisfactionSum: 0, satisfactionCount: 0,
}

describe('buildProfile', () => {
  it('computes scores (productivity capped at 100 when faster than estimate)', () => {
    const p = buildProfile(alice)
    expect(p.scores.productivity).toBe(100)
    expect(p.scores.quality).toBe(90)
    expect(p.scores.punctuality).toBe(90)
    expect(p.scores.satisfaction).toBe(90)
    expect(p.scores.total).toBe(93)
  })

  it('awards the right badges', () => {
    const ids = buildProfile(alice).badges.map((b) => b.id)
    expect(ids).toContain('speed_demon')
    expect(ids).toContain('customer_favorite')
    expect(ids).toContain('all_rounder')
    expect(ids).not.toContain('quality_master') // quality 90 < 95
  })

  it('handles missing satisfaction (weight redistributed)', () => {
    const p = buildProfile(cleo)
    expect(p.scores.satisfaction).toBeNull()
    expect(p.scores.total).toBe(100)
  })

  it('earns the Centurion badge at 100 jobs', () => {
    const ids = buildProfile(bob).badges.map((b) => b.id)
    expect(ids).toContain('centurion')
    expect(ids).toContain('quality_master')
  })
})

describe('levels', () => {
  it('follows the quadratic curve', () => {
    expect(xpForLevel(2)).toBe(100)
    expect(xpForLevel(3)).toBe(400)
    expect(levelInfo(100).level).toBe(2)
    expect(levelInfo(0).level).toBe(1)
  })
})

describe('buildLeaderboard', () => {
  it('ranks by total then level, and aggregates the team', () => {
    const lb = buildLeaderboard([alice, bob, cleo])
    // Bob and Cléo both total 100; Bob's higher level breaks the tie.
    expect(lb.ranking[0].id).toBe('b')
    expect(lb.ranking[1].id).toBe('c')
    expect(lb.ranking[2].id).toBe('a')
    expect(lb.team.jobsCompleted).toBe(115)
    expect(lb.team.mechanics).toBe(3)
    expect(lb.team.avgTotal).toBeCloseTo(97.7, 1)
  })

  it('surfaces team averages even when a score is missing for some', () => {
    const lb = buildLeaderboard([cleo])
    expect(lb.team.avgSatisfaction).toBeNull()
    expect(lb.team.avgProductivity).toBe(100)
  })
})
