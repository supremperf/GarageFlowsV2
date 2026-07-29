/**
 * Dashboard assembly. Pure & deterministic.
 *
 * Each KPI gets a trend (direction of change vs the previous period) and a
 * status (good/warning/critical) derived from its thresholds, interpreted
 * according to whether higher or lower is better. A composite health score
 * (0..100) is penalised by KPI statuses and insight severities; insights are
 * sorted most-severe first.
 */
import type {
  BuildDashboardInput,
  DashboardInsight,
  DecisionDashboard,
  InsightSeverity,
  Kpi,
  KpiInput,
  KpiStatus,
  Trend,
} from './types'

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Percent change vs previous; null when previous is unknown or zero. */
export function deltaPct(value: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0 || !Number.isFinite(previous) || !Number.isFinite(value)) return null
  return round1(((value - previous) / Math.abs(previous)) * 100)
}

function trendOf(value: number, previous: number | null | undefined): Trend {
  if (previous == null || !Number.isFinite(previous)) return 'flat'
  if (value > previous) return 'up'
  if (value < previous) return 'down'
  return 'flat'
}

/** Status from thresholds, interpreted per direction. Neutral when no threshold. */
export function kpiStatus(input: KpiInput): KpiStatus {
  const { value, warnAt, critAt } = input
  const dir = input.direction ?? 'higher_better'
  const worse = (a: number, threshold: number) => (dir === 'higher_better' ? a <= threshold : a >= threshold)

  if (critAt != null && worse(value, critAt)) return 'critical'
  if (warnAt != null && worse(value, warnAt)) return 'warning'
  if (warnAt != null || critAt != null) return 'good'
  return 'neutral'
}

export function computeKpi(input: KpiInput): Kpi {
  const previous = input.previous ?? null
  return {
    key: input.key,
    label: input.label,
    value: input.value,
    unit: input.unit ?? '',
    previous,
    deltaPct: deltaPct(input.value, previous),
    trend: trendOf(input.value, previous),
    direction: input.direction ?? 'higher_better',
    target: input.target ?? null,
    status: kpiStatus(input),
  }
}

const SEVERITY_RANK: Record<InsightSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const INSIGHT_PENALTY: Record<InsightSeverity, number> = { critical: 15, high: 8, medium: 3, low: 1, info: 0 }
const KPI_PENALTY: Record<KpiStatus, number> = { critical: 20, warning: 8, good: 0, neutral: 0 }

function healthLabel(score: number): string {
  if (score >= 80) return 'Excellent'
  if (score >= 60) return 'Bon'
  if (score >= 40) return 'À surveiller'
  return 'Critique'
}

export function buildDashboard(input: BuildDashboardInput): DecisionDashboard {
  const kpis = input.kpis.map(computeKpi)
  const insights = (input.insights ?? [])
    .slice()
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])

  let score = 100
  for (const k of kpis) score -= KPI_PENALTY[k.status]
  for (const i of insights) score -= INSIGHT_PENALTY[i.severity]
  const healthScore = Math.max(0, Math.min(100, Math.round(score)))

  const summary = {
    criticalKpis: kpis.filter((k) => k.status === 'critical').length,
    warningKpis: kpis.filter((k) => k.status === 'warning').length,
    criticalInsights: insights.filter((i: DashboardInsight) => i.severity === 'critical').length,
  }

  return {
    kpis,
    healthScore,
    healthLabel: healthLabel(healthScore),
    insights,
    period: input.period ?? { label: 'Période courante' },
    summary,
  }
}
