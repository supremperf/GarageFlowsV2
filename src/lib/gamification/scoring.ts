/**
 * Score computation — pure. Each score is 0..100 or null when there's no data.
 */
import type { MechanicStats, ScoreBreakdown } from './types'

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n))
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Efficiency: estimated vs actual time. ≥100 when at or under the estimate. */
export function productivityScore(s: MechanicStats): number | null {
  if (s.actualMinutes <= 0 || s.estimatedMinutes <= 0) return null
  return round1(clamp((s.estimatedMinutes / s.actualMinutes) * 100))
}

/** Quality: share of jobs that did NOT need rework. */
export function qualityScore(s: MechanicStats): number | null {
  if (s.jobsCompleted <= 0) return null
  return round1(clamp(100 * (1 - s.reworkJobs / s.jobsCompleted)))
}

/** Punctuality: share of jobs completed on time. */
export function punctualityScore(s: MechanicStats): number | null {
  if (s.jobsCompleted <= 0) return null
  return round1(clamp((100 * s.onTimeJobs) / s.jobsCompleted))
}

/** Satisfaction: average rating (0..5) as a percentage. */
export function satisfactionScore(s: MechanicStats): number | null {
  if (s.satisfactionCount <= 0) return null
  return round1(clamp((s.satisfactionSum / s.satisfactionCount / 5) * 100))
}

const WEIGHTS = { productivity: 0.3, quality: 0.3, punctuality: 0.2, satisfaction: 0.2 }

/** Weighted total over the available (non-null) scores, weights renormalized. */
export function computeScores(s: MechanicStats): ScoreBreakdown {
  const productivity = productivityScore(s)
  const quality = qualityScore(s)
  const punctuality = punctualityScore(s)
  const satisfaction = satisfactionScore(s)

  const parts: Array<[number | null, number]> = [
    [productivity, WEIGHTS.productivity],
    [quality, WEIGHTS.quality],
    [punctuality, WEIGHTS.punctuality],
    [satisfaction, WEIGHTS.satisfaction],
  ]
  let weighted = 0
  let weightSum = 0
  for (const [value, w] of parts) {
    if (value !== null) {
      weighted += value * w
      weightSum += w
    }
  }
  const total = weightSum > 0 ? round1(weighted / weightSum) : 0
  return { productivity, quality, punctuality, satisfaction, total }
}
