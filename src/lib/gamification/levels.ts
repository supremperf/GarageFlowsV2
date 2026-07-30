/**
 * XP & level curve — pure.
 *
 * XP rewards throughput and value; the level curve is quadratic so early levels
 * come quickly and later ones require sustained performance.
 *   xp needed to reach level L = (L-1)² × 100
 */
import type { LevelInfo, MechanicStats, ScoreBreakdown } from './types'

/** XP from completed jobs, revenue and overall score. */
export function computeXp(stats: MechanicStats, scores: ScoreBreakdown): number {
  const jobXp = stats.jobsCompleted * 10
  const revenueXp = Math.round((stats.revenueHT ?? 0) / 50)
  const scoreXp = Math.round(scores.total)
  return jobXp + revenueXp + scoreXp
}

export function xpForLevel(level: number): number {
  return (level - 1) ** 2 * 100
}

export function levelInfo(xp: number): LevelInfo {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1
  const start = xpForLevel(level)
  const next = xpForLevel(level + 1)
  const span = next - start
  const into = xp - start
  return {
    level,
    xp,
    xpIntoLevel: into,
    xpForNextLevel: next - xp,
    progressPct: span > 0 ? Math.round((into / span) * 100) : 0,
  }
}
