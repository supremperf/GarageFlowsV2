/**
 * Gamification — shared types.
 *
 * Turns per-mechanic performance stats into scores, XP/levels, badges and a
 * leaderboard. Designed to motivate without toxic competition: individual
 * progress (level, personal scores, badges) is first-class, and team aggregates
 * are surfaced alongside any ranking.
 */

export interface MechanicStats {
  id: string
  name: string
  jobsCompleted: number
  /** Sum of estimated durations (minutes). */
  estimatedMinutes: number
  /** Sum of actual durations (minutes). */
  actualMinutes: number
  /** Jobs completed without delay. */
  onTimeJobs: number
  /** Jobs that had to be redone / came back. */
  reworkJobs: number
  /** Sum of client satisfaction ratings (0..5). */
  satisfactionSum: number
  satisfactionCount: number
  /** Optional revenue generated (HT), feeds XP. */
  revenueHT?: number
}

export interface ScoreBreakdown {
  productivity: number | null
  quality: number | null
  punctuality: number | null
  satisfaction: number | null
  /** Weighted total over available scores (0..100). */
  total: number
}

export interface Badge {
  id: string
  name: string
  description: string
  tier: 'bronze' | 'silver' | 'gold'
}

export interface LevelInfo {
  level: number
  xp: number
  xpIntoLevel: number
  xpForNextLevel: number
  progressPct: number
}

export interface MechanicProfile {
  id: string
  name: string
  jobsCompleted: number
  scores: ScoreBreakdown
  level: LevelInfo
  badges: Badge[]
}

export interface Leaderboard {
  ranking: Array<{ rank: number; id: string; name: string; total: number; level: number }>
  profiles: MechanicProfile[]
  team: {
    mechanics: number
    jobsCompleted: number
    avgProductivity: number | null
    avgQuality: number | null
    avgPunctuality: number | null
    avgSatisfaction: number | null
    avgTotal: number
  }
}
