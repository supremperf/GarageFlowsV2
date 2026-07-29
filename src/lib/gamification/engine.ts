/**
 * Gamification engine — build individual profiles and a team leaderboard.
 */
import { evaluateBadges } from './badges'
import { computeXp, levelInfo } from './levels'
import { computeScores } from './scoring'
import type { Leaderboard, MechanicProfile, MechanicStats } from './types'

export function buildProfile(stats: MechanicStats): MechanicProfile {
  const scores = computeScores(stats)
  const xp = computeXp(stats, scores)
  const level = levelInfo(xp)
  const badges = evaluateBadges({ stats, scores, level: level.level })
  return { id: stats.id, name: stats.name, jobsCompleted: stats.jobsCompleted, scores, level, badges }
}

function avg(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null)
  if (present.length === 0) return null
  return Math.round((present.reduce((s, v) => s + v, 0) / present.length) * 10) / 10
}

export function buildLeaderboard(list: MechanicStats[]): Leaderboard {
  const profiles = list.map(buildProfile)

  const ranked = [...profiles].sort((a, b) => {
    if (b.scores.total !== a.scores.total) return b.scores.total - a.scores.total
    if (b.level.level !== a.level.level) return b.level.level - a.level.level
    return a.name.localeCompare(b.name)
  })
  const ranking = ranked.map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, total: p.scores.total, level: p.level.level }))

  const team = {
    mechanics: profiles.length,
    jobsCompleted: profiles.reduce((s, p) => s + p.jobsCompleted, 0),
    avgProductivity: avg(profiles.map((p) => p.scores.productivity)),
    avgQuality: avg(profiles.map((p) => p.scores.quality)),
    avgPunctuality: avg(profiles.map((p) => p.scores.punctuality)),
    avgSatisfaction: avg(profiles.map((p) => p.scores.satisfaction)),
    avgTotal: avg(profiles.map((p) => p.scores.total)) ?? 0,
  }

  return { ranking, profiles, team }
}
