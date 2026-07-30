/**
 * Decision dashboard — domain types. Framework-free & serialisable.
 *
 * The engine turns raw period metrics (+ their previous-period values) and a set
 * of insights into KPIs with a trend and a status, a composite health score, and
 * a prioritised alert list. It is deterministic — the API feeds it real data
 * gathered from the other engines (profitability, forecast, stock, proactive…).
 */

export type Trend = 'up' | 'down' | 'flat'
export type KpiStatus = 'good' | 'warning' | 'critical' | 'neutral'
/** Whether a higher value is better (revenue) or worse (low-stock count). */
export type KpiDirection = 'higher_better' | 'lower_better'

export interface KpiInput {
  key: string
  label: string
  value: number
  /** Previous-period value for the trend (null/undefined = unknown). */
  previous?: number | null
  /** Display unit: '€', '%', 'j', '' … */
  unit?: string
  direction?: KpiDirection
  /** Optional objective for context. */
  target?: number | null
  /** Threshold at which the KPI is a warning (interpreted per direction). */
  warnAt?: number | null
  /** Threshold at which the KPI is critical (interpreted per direction). */
  critAt?: number | null
}

export interface Kpi {
  key: string
  label: string
  value: number
  unit: string
  previous: number | null
  /** Percent change vs previous, or null when it can't be computed. */
  deltaPct: number | null
  /** Direction of change (neutral of "good/bad"). */
  trend: Trend
  direction: KpiDirection
  target: number | null
  status: KpiStatus
}

export type InsightSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface DashboardInsight {
  id: string
  severity: InsightSeverity
  title: string
  message: string
  /** Which engine/source produced it (proactive, memory, stock…). */
  source: string
  metric?: Record<string, number | string>
}

export interface DecisionDashboard {
  kpis: Kpi[]
  /** 0..100 composite health from KPI statuses and insight severities. */
  healthScore: number
  healthLabel: string
  insights: DashboardInsight[]
  period: { label: string; from?: string; to?: string }
  summary: { criticalKpis: number; warningKpis: number; criticalInsights: number }
}

export interface BuildDashboardInput {
  kpis: KpiInput[]
  insights?: DashboardInsight[]
  period?: { label: string; from?: string; to?: string }
}
