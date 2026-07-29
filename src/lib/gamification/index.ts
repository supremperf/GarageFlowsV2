/**
 * Gamification — public entry point.
 *
 *   import { buildProfile, buildLeaderboard } from '@/lib/gamification'
 *
 * Deterministic scores (productivity/quality/punctuality/satisfaction), XP/levels,
 * badges and a team leaderboard. Individual progress is first-class; team
 * aggregates are always surfaced to avoid toxic competition.
 */
export * from './types'
export {
  computeScores,
  productivityScore,
  qualityScore,
  punctualityScore,
  satisfactionScore,
} from './scoring'
export { computeXp, levelInfo, xpForLevel } from './levels'
export { BADGE_RULES, evaluateBadges } from './badges'
export { buildProfile, buildLeaderboard } from './engine'
