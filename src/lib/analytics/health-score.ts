/**
 * Phase 5 — Garage Health Score.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A single 0–100 score summarising the health of a garage, built from
 * {@link GarageMetrics} — i.e. exclusively from real persisted data. Each
 * component sub-score is 0–100; the global score is their weighted average.
 *
 * Honesty guarantee: a component with insufficient data is `available: false`
 * and is EXCLUDED from the weighted average (weights are renormalised over the
 * available components). The score is never padded with invented values, and
 * `dataSufficiency` reports what backed it.
 */

import type { GarageMetrics } from './metrics'

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n))

export type HealthGrade = 'excellent' | 'good' | 'fair' | 'poor' | 'critical'

export interface SubScore {
  key: string
  label: string
  /** 0–100, or null when there is not enough data to score this component. */
  score: number | null
  /** Relative weight in the global average (only counted when available). */
  weight: number
  available: boolean
  /** Short, data-referenced explanation of the sub-score. */
  detail: string
}

export interface HealthTrend {
  direction: 'up' | 'down' | 'stable' | 'unknown'
  /** Score delta vs the previous window, or null when not comparable. */
  delta: number | null
  previousScore: number | null
}

export interface HealthScore {
  /** Weighted global score 0–100 (0 when no component is available). */
  score: number
  grade: HealthGrade
  subScores: SubScore[]
  trend: HealthTrend
  recommendations: string[]
  /** Fraction of total weight that was actually backed by data (0–1). */
  coverage: number
  computedAt: string
}

/** Component weights (relative; renormalised over available components). */
const WEIGHTS = {
  profitability: 25,
  unpaid: 15,
  efficiency: 15,
  immobilization: 10,
  stock: 10,
  productivity: 10,
  quoteConversion: 8,
  quality: 7,
} as const

function gradeFor(score: number): HealthGrade {
  if (score >= 85) return 'excellent'
  if (score >= 70) return 'good'
  if (score >= 55) return 'fair'
  if (score >= 40) return 'poor'
  return 'critical'
}

/** Build the list of component sub-scores from the metrics. */
function buildSubScores(m: GarageMetrics): SubScore[] {
  const subs: SubScore[] = []

  // 1. Profitability — from margin rate (40% margin → 100).
  if (m.dataSufficiency.revenue && m.revenue.marginRatePct != null) {
    const score = clamp(m.revenue.marginRatePct * 2.5)
    subs.push({
      key: 'profitability', label: 'Rentabilité', score, weight: WEIGHTS.profitability, available: true,
      detail: `Marge ${m.revenue.marginRatePct}% sur ${m.revenue.invoiceCount} facture(s) payée(s).`,
    })
  } else {
    subs.push({ key: 'profitability', label: 'Rentabilité', score: null, weight: WEIGHTS.profitability, available: false, detail: 'Aucune facture payée sur la période.' })
  }

  // 2. Unpaid — outstanding vs total billed.
  const billed = m.revenue.paidTTC + m.outstandingTTC
  if (billed > 0) {
    const ratio = m.outstandingTTC / billed
    subs.push({
      key: 'unpaid', label: 'Impayés', score: clamp(100 - ratio * 100), weight: WEIGHTS.unpaid, available: true,
      detail: `${Math.round(ratio * 100)}% du facturé en attente (${m.overdueInvoices.length} en retard).`,
    })
  } else {
    subs.push({ key: 'unpaid', label: 'Impayés', score: null, weight: WEIGHTS.unpaid, available: false, detail: 'Aucune facture émise.' })
  }

  // 3. Efficiency — estimated vs actual repair time.
  if (m.dataSufficiency.repairTime && m.repairTime.efficiencyPct != null) {
    subs.push({
      key: 'efficiency', label: 'Délai moyen', score: clamp(m.repairTime.efficiencyPct), weight: WEIGHTS.efficiency, available: true,
      detail: `Efficacité ${m.repairTime.efficiencyPct}% (réel ${m.repairTime.avgActualMin} min vs estimé ${m.repairTime.avgEstimatedMin} min).`,
    })
  } else {
    subs.push({ key: 'efficiency', label: 'Délai moyen', score: null, weight: WEIGHTS.efficiency, available: false, detail: 'Pas assez d’interventions terminées chronométrées.' })
  }

  // 4. Immobilization — immobilised vehicles vs open jobs.
  if (m.totals.openJobCount > 0) {
    const ratio = m.immobilizedVehicles.length / m.totals.openJobCount
    subs.push({
      key: 'immobilization', label: 'Immobilisation', score: clamp(100 - ratio * 100), weight: WEIGHTS.immobilization, available: true,
      detail: `${m.immobilizedVehicles.length}/${m.totals.openJobCount} véhicule(s) immobilisé(s) trop longtemps.`,
    })
  } else {
    subs.push({ key: 'immobilization', label: 'Immobilisation', score: null, weight: WEIGHTS.immobilization, available: false, detail: 'Aucune intervention en cours.' })
  }

  // 5. Stock — availability of parts (critical weighted 3× a low item).
  if (m.dataSufficiency.stock && m.totals.partCount > 0) {
    const penalty = (m.criticalStock.length * 3 + m.lowStock.length) / m.totals.partCount
    subs.push({
      key: 'stock', label: 'Disponibilité pièces', score: clamp(100 - penalty * 100), weight: WEIGHTS.stock, available: true,
      detail: `${m.criticalStock.length} rupture(s), ${m.lowStock.length} stock(s) bas sur ${m.totals.partCount} pièce(s).`,
    })
  } else {
    subs.push({ key: 'stock', label: 'Disponibilité pièces', score: null, weight: WEIGHTS.stock, available: false, detail: 'Aucune pièce en stock référencée.' })
  }

  // 6. Productivity — workshop utilisation.
  if (m.dataSufficiency.mechanics && m.utilizationPct != null) {
    subs.push({
      key: 'productivity', label: 'Productivité', score: clamp(m.utilizationPct), weight: WEIGHTS.productivity, available: true,
      detail: `Taux d’occupation atelier ${m.utilizationPct}%.`,
    })
  } else {
    subs.push({ key: 'productivity', label: 'Productivité', score: null, weight: WEIGHTS.productivity, available: false, detail: 'Aucun mécanicien / capacité définie.' })
  }

  // 7. Quote conversion.
  if (m.quoteConversionPct != null) {
    subs.push({
      key: 'quoteConversion', label: 'Conversion devis', score: clamp(m.quoteConversionPct), weight: WEIGHTS.quoteConversion, available: true,
      detail: `${m.quoteConversionPct}% des devis résolus sont acceptés.`,
    })
  } else {
    subs.push({ key: 'quoteConversion', label: 'Conversion devis', score: null, weight: WEIGHTS.quoteConversion, available: false, detail: 'Aucun devis résolu.' })
  }

  // 8. Quality — after-sales / warranty claim rate.
  if (m.activeWarrantyClaimRatePct != null) {
    subs.push({
      key: 'quality', label: 'Qualité / SAV', score: clamp(100 - m.activeWarrantyClaimRatePct), weight: WEIGHTS.quality, available: true,
      detail: `${m.activeWarrantyClaimRatePct}% des garanties finissent en réclamation.`,
    })
  } else {
    subs.push({ key: 'quality', label: 'Qualité / SAV', score: null, weight: WEIGHTS.quality, available: false, detail: 'Aucune garantie enregistrée.' })
  }

  return subs
}

/** Weighted average of the available sub-scores; 0 when none are available. */
function weightedScore(subs: SubScore[]): { score: number; coverage: number } {
  const available = subs.filter(s => s.available && s.score != null)
  const totalWeight = subs.reduce((s, x) => s + x.weight, 0)
  const usedWeight = available.reduce((s, x) => s + x.weight, 0)
  if (usedWeight === 0) return { score: 0, coverage: 0 }
  const score = available.reduce((s, x) => s + (x.score as number) * x.weight, 0) / usedWeight
  return { score: Math.round(score), coverage: usedWeight / totalWeight }
}

/**
 * Compute the garage health score. Pass `previous` (metrics of the preceding
 * window) to obtain a real period-over-period trend.
 */
export function computeHealthScore(m: GarageMetrics, previous?: GarageMetrics): HealthScore {
  const subScores = buildSubScores(m)
  const { score, coverage } = weightedScore(subScores)

  let trend: HealthTrend = { direction: 'unknown', delta: null, previousScore: null }
  if (previous) {
    const prev = weightedScore(buildSubScores(previous))
    if (prev.coverage > 0) {
      const delta = score - prev.score
      trend = {
        direction: delta > 2 ? 'up' : delta < -2 ? 'down' : 'stable',
        delta,
        previousScore: prev.score,
      }
    }
  }

  // Recommendations: available components scoring below 60, weakest first.
  const recommendations = subScores
    .filter(s => s.available && s.score != null && (s.score as number) < 60)
    .sort((a, b) => (a.score as number) - (b.score as number))
    .map(s => `${s.label} (${s.score}/100) — ${s.detail}`)

  return {
    score,
    grade: gradeFor(score),
    subScores,
    trend,
    recommendations,
    coverage: Math.round(coverage * 100) / 100,
    computedAt: new Date().toISOString(),
  }
}
