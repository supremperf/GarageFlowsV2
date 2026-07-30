/**
 * Badge definitions & evaluation — pure.
 */
import type { Badge, MechanicStats, ScoreBreakdown } from './types'

interface BadgeRule extends Badge {
  earned: (ctx: { stats: MechanicStats; scores: ScoreBreakdown; level: number }) => boolean
}

export const BADGE_RULES: BadgeRule[] = [
  {
    id: 'speed_demon', name: 'Éclair', tier: 'silver',
    description: 'Productivité au niveau ou au-dessus du barème.',
    earned: ({ scores }) => (scores.productivity ?? 0) >= 100,
  },
  {
    id: 'quality_master', name: 'Zéro défaut', tier: 'gold',
    description: 'Aucune reprise sur au moins 10 interventions.',
    earned: ({ stats, scores }) => stats.jobsCompleted >= 10 && (scores.quality ?? 0) >= 95,
  },
  {
    id: 'always_on_time', name: 'À l\'heure', tier: 'silver',
    description: 'Ponctualité ≥ 95 % sur au moins 10 interventions.',
    earned: ({ stats, scores }) => stats.jobsCompleted >= 10 && (scores.punctuality ?? 0) >= 95,
  },
  {
    id: 'customer_favorite', name: 'Chouchou des clients', tier: 'gold',
    description: 'Satisfaction client ≥ 90 %.',
    earned: ({ scores }) => (scores.satisfaction ?? 0) >= 90,
  },
  {
    id: 'centurion', name: 'Centurion', tier: 'gold',
    description: '100 interventions terminées.',
    earned: ({ stats }) => stats.jobsCompleted >= 100,
  },
  {
    id: 'all_rounder', name: 'Polyvalent', tier: 'gold',
    description: 'Tous les scores ≥ 80.',
    earned: ({ scores }) =>
      [scores.productivity, scores.quality, scores.punctuality, scores.satisfaction].every((v) => (v ?? 0) >= 80),
  },
  {
    id: 'rising_star', name: 'Étoile montante', tier: 'bronze',
    description: 'Niveau 5 atteint.',
    earned: ({ level }) => level >= 5,
  },
]

export function evaluateBadges(ctx: { stats: MechanicStats; scores: ScoreBreakdown; level: number }): Badge[] {
  return BADGE_RULES.filter((r) => r.earned(ctx)).map(({ id, name, description, tier }) => ({ id, name, description, tier }))
}
