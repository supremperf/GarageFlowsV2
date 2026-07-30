/**
 * Phase 4 & 6 — Copilote insights engine ("Analyser mon garage").
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Turns {@link GarageMetrics} into a prioritised, human-readable set of findings.
 * Every insight is DETERMINISTIC and carries the real numbers that produced it
 * (`evidence`) — there is no language model in the loop and therefore no risk of
 * hallucination. When a data family is empty, the engine emits an explicit
 * "données insuffisantes" note instead of guessing (`dataGaps`).
 *
 * The same output serves the dirigeant dashboard (Phase 4) and the one-click
 * "Analyser mon garage" report (Phase 6).
 */

import type { GarageMetrics } from './metrics'
import { computeHealthScore, type HealthScore } from './health-score'

export type InsightSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type InsightCategory = 'finance' | 'operations' | 'stock' | 'clients' | 'quality' | 'sales'

export interface Insight {
  /** Stable identifier for the finding type. */
  id: string
  category: InsightCategory
  severity: InsightSeverity
  title: string
  /** Human-readable, always references the real figures behind the finding. */
  description: string
  /** Recommended concrete action. */
  action: string
  /** Magnitude used to rank insights of equal severity (€, count·weight, …). */
  impact: number
  /** The raw data points that justify this insight (explainability). */
  evidence: Record<string, unknown>
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
}

/** How much of the mission's at-risk-client threshold counts as "leaving". */
const AT_RISK_INACTIVE_DAYS = 365

/**
 * Generate the full list of findings from the metrics, ranked by severity then
 * impact. `dataGaps` lists the areas that could not be analysed for lack of data.
 */
export function generateInsights(m: GarageMetrics): { insights: Insight[]; dataGaps: string[] } {
  const insights: Insight[] = []
  const dataGaps: string[] = []

  // ── Finance: overdue invoices ──────────────────────────────────────────────
  if (m.overdueInvoices.length > 0) {
    const total = m.overdueInvoices.reduce((s, i) => s + i.amountTTC, 0)
    insights.push({
      id: 'overdue-invoices',
      category: 'finance',
      severity: total > 0 ? 'high' : 'medium',
      title: `${m.overdueInvoices.length} facture(s) en retard de paiement`,
      description: `${Math.round(total)} € TTC en souffrance. La plus ancienne est en retard de ${m.overdueInvoices[0].daysOverdue} jour(s).`,
      action: 'Relancer les clients concernés (rappel écrit, puis mise en demeure).',
      impact: total,
      evidence: { count: m.overdueInvoices.length, totalTTC: Math.round(total), items: m.overdueInvoices.slice(0, 5) },
    })
  }

  // ── Finance: profitability anomaly ─────────────────────────────────────────
  if (m.dataSufficiency.revenue && m.revenue.marginRatePct != null) {
    if (m.revenue.marginRatePct < 20) {
      insights.push({
        id: 'low-margin',
        category: 'finance',
        severity: m.revenue.marginRatePct < 10 ? 'high' : 'medium',
        title: `Marge faible (${m.revenue.marginRatePct}%)`,
        description: `Marge HT de ${Math.round(m.revenue.marginHT)} € pour ${Math.round(m.revenue.paidHT)} € facturés.`,
        action: 'Revoir les tarifs de main-d’œuvre et les prix d’achat des pièces.',
        impact: Math.max(0, (20 - m.revenue.marginRatePct)) * 100,
        evidence: { marginRatePct: m.revenue.marginRatePct, marginHT: Math.round(m.revenue.marginHT), paidHT: Math.round(m.revenue.paidHT) },
      })
    }
  } else {
    dataGaps.push('Rentabilité : aucune facture payée sur la période — marge non calculable.')
  }

  // ── Operations: immobilised vehicles ───────────────────────────────────────
  if (m.immobilizedVehicles.length > 0) {
    const worst = m.immobilizedVehicles[0]
    insights.push({
      id: 'immobilized-vehicles',
      category: 'operations',
      severity: worst.days >= 10 ? 'high' : 'medium',
      title: `${m.immobilizedVehicles.length} véhicule(s) immobilisé(s) anormalement`,
      description: `Le plus ancien : ${worst.licensePlate ?? worst.vehicleModel ?? worst.customerName} depuis ${worst.days} jour(s) (statut « ${worst.status} »).`,
      action: 'Prioriser ces interventions ou informer les clients d’un délai.',
      impact: m.immobilizedVehicles.reduce((s, v) => s + v.days, 0),
      evidence: { count: m.immobilizedVehicles.length, items: m.immobilizedVehicles.slice(0, 5) },
    })
  }

  // ── Operations: top costly vehicles (time) ─────────────────────────────────
  if (m.topCostlyVehicles.length > 0) {
    insights.push({
      id: 'top-costly-vehicles',
      category: 'operations',
      severity: 'info',
      title: 'Véhicules les plus coûteux en temps',
      description: `Top ${m.topCostlyVehicles.length} : ${m.topCostlyVehicles.map(v => `${v.licensePlate} (${Math.round(v.totalMin / 60)} h)`).join(', ')}.`,
      action: 'Analyser la récurrence des interventions sur ces véhicules.',
      impact: m.topCostlyVehicles[0]?.totalMin ?? 0,
      evidence: { items: m.topCostlyVehicles },
    })
  }

  // ── Operations: mechanic load imbalance ────────────────────────────────────
  if (m.dataSufficiency.mechanics && m.mechanicLoads.length > 0) {
    const overloaded = m.mechanicLoads.filter(l => l.capacityMin > 0 && l.loadPct >= 90)
    const underused = m.mechanicLoads.filter(l => l.capacityMin > 0 && l.loadPct <= 30)
    if (overloaded.length > 0) {
      insights.push({
        id: 'overloaded-mechanics',
        category: 'operations',
        severity: 'medium',
        title: `${overloaded.length} mécanicien(s) surchargé(s)`,
        description: overloaded.map(l => `${l.name} à ${l.loadPct}%`).join(', ') + '.',
        action: 'Rééquilibrer les affectations vers les mécaniciens sous-utilisés.',
        impact: overloaded.reduce((s, l) => s + l.loadPct, 0),
        evidence: { overloaded, underused },
      })
    }
    if (underused.length > 0) {
      insights.push({
        id: 'underused-mechanics',
        category: 'operations',
        severity: 'low',
        title: `${underused.length} mécanicien(s) sous-utilisé(s)`,
        description: underused.map(l => `${l.name} à ${l.loadPct}%`).join(', ') + '.',
        action: 'Leur affecter davantage d’interventions ou avancer des rendez-vous.',
        impact: underused.length,
        evidence: { underused },
      })
    }
  } else {
    dataGaps.push('Charge atelier : aucun mécanicien configuré — répartition non analysable.')
  }

  // ── Stock: critical & low ──────────────────────────────────────────────────
  if (m.criticalStock.length > 0) {
    insights.push({
      id: 'critical-stock',
      category: 'stock',
      severity: 'high',
      title: `${m.criticalStock.length} pièce(s) en rupture de stock`,
      description: `Ex. : ${m.criticalStock.slice(0, 3).map(p => p.name).join(', ')}.`,
      action: 'Commander en urgence les pièces en rupture.',
      impact: m.criticalStock.length * 10,
      evidence: { items: m.criticalStock.slice(0, 10) },
    })
  }
  if (m.lowStock.length > 0) {
    insights.push({
      id: 'low-stock',
      category: 'stock',
      severity: 'medium',
      title: `${m.lowStock.length} pièce(s) bientôt en rupture`,
      description: `Sous le seuil minimal : ${m.lowStock.slice(0, 3).map(p => `${p.name} (${p.quantity}/${p.minQuantity})`).join(', ')}.`,
      action: 'Planifier un réapprovisionnement.',
      impact: m.lowStock.reduce((s, p) => s + p.shortBy, 0),
      evidence: { items: m.lowStock.slice(0, 10) },
    })
  }

  // ── Sales: un-followed quotes ──────────────────────────────────────────────
  if (m.staleQuotes.length > 0) {
    const total = m.staleQuotes.reduce((s, q) => s + q.amountTTC, 0)
    insights.push({
      id: 'stale-quotes',
      category: 'sales',
      severity: 'medium',
      title: `${m.staleQuotes.length} devis à relancer`,
      description: `${Math.round(total)} € TTC de devis envoyés sans réponse (dont ${m.staleQuotes.filter(q => q.expired).length} expiré(s)).`,
      action: 'Relancer les clients pour convertir ces devis.',
      impact: total,
      evidence: { count: m.staleQuotes.length, totalTTC: Math.round(total), items: m.staleQuotes.slice(0, 5) },
    })
  }

  // ── Clients: follow-up & churn risk ────────────────────────────────────────
  if (m.inactiveClients.length > 0) {
    const atRisk = m.inactiveClients.filter(c => (c.daysInactive ?? 0) >= AT_RISK_INACTIVE_DAYS)
    insights.push({
      id: 'inactive-clients',
      category: 'clients',
      severity: 'low',
      title: `${m.inactiveClients.length} client(s) à relancer`,
      description: `Sans activité depuis longtemps (le plus ancien : ${m.inactiveClients[0].daysInactive} jour(s)).`,
      action: 'Campagne de rappel (entretien, contrôle technique).',
      impact: m.inactiveClients.length,
      evidence: { count: m.inactiveClients.length, items: m.inactiveClients.slice(0, 10) },
    })
    if (atRisk.length > 0) {
      insights.push({
        id: 'churn-risk-clients',
        category: 'clients',
        severity: 'medium',
        title: `${atRisk.length} client(s) à risque de départ`,
        description: `Aucune activité depuis plus de ${Math.round(AT_RISK_INACTIVE_DAYS / 30)} mois.`,
        action: 'Contact personnalisé prioritaire (offre de fidélité).',
        impact: atRisk.length * 5,
        evidence: { count: atRisk.length, items: atRisk.slice(0, 10) },
      })
    }
  }

  // ── Quality: expiring warranties ───────────────────────────────────────────
  if (m.expiringWarranties.length > 0) {
    insights.push({
      id: 'expiring-warranties',
      category: 'quality',
      severity: 'low',
      title: `${m.expiringWarranties.length} garantie(s) proche(s) de l’échéance`,
      description: `La plus proche expire dans ${m.expiringWarranties[0].daysLeft} jour(s).`,
      action: 'Informer les clients avant expiration.',
      impact: m.expiringWarranties.length,
      evidence: { items: m.expiringWarranties.slice(0, 10) },
    })
  }

  // ── Operations: cancelled jobs ─────────────────────────────────────────────
  if (m.cancelledJobCount > 0) {
    insights.push({
      id: 'cancelled-jobs',
      category: 'operations',
      severity: m.cancelledJobCount >= 5 ? 'medium' : 'low',
      title: `${m.cancelledJobCount} rendez-vous annulé(s)`,
      description: `${m.cancelledJobCount} intervention(s) annulée(s) sur la période.`,
      action: 'Analyser les motifs d’annulation et mettre en place des rappels.',
      impact: m.cancelledJobCount,
      evidence: { cancelledJobCount: m.cancelledJobCount },
    })
  }

  insights.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    return sev !== 0 ? sev : b.impact - a.impact
  })

  return { insights, dataGaps }
}

// ─── Copilote report ─────────────────────────────────────────────────────────

export interface PriorityAction {
  rank: number
  title: string
  action: string
  severity: InsightSeverity
  category: InsightCategory
}

export interface CopilotReport {
  generatedAt: string
  periodDays: number
  summary: string
  healthScore: number
  healthGrade: HealthScore['grade']
  insights: Insight[]
  priorityActions: PriorityAction[]
  forecast: { weeklyMarginHT: number | null; basis: string }
  dataGaps: string[]
}

/** Extrapolate the observed daily margin to a 7-day forecast (clearly labelled). */
function forecastWeeklyMargin(m: GarageMetrics): { weeklyMarginHT: number | null; basis: string } {
  if (!m.dataSufficiency.revenue || m.periodDays <= 0) {
    return { weeklyMarginHT: null, basis: 'Données insuffisantes (aucune facture payée) pour une prévision.' }
  }
  const dailyMargin = m.revenue.marginHT / m.periodDays
  return {
    weeklyMarginHT: Math.round(dailyMargin * 7),
    basis: `Extrapolation de la marge moyenne (${Math.round(m.revenue.marginHT)} € HT sur ${m.periodDays} j) à 7 jours.`,
  }
}

/**
 * Build the complete "Analyser mon garage" report: health score, ranked
 * insights, prioritised actions, a labelled weekly forecast and explicit data
 * gaps. `previous` (preceding-window metrics) enables the health trend.
 */
export function buildCopilotReport(m: GarageMetrics, previous?: GarageMetrics): CopilotReport {
  const health = computeHealthScore(m, previous)
  const { insights, dataGaps } = generateInsights(m)

  const priorityActions: PriorityAction[] = insights
    .filter(i => i.severity !== 'info')
    .slice(0, 5)
    .map((i, idx) => ({
      rank: idx + 1,
      title: i.title,
      action: i.action,
      severity: i.severity,
      category: i.category,
    }))

  const actionable = insights.filter(i => i.severity === 'critical' || i.severity === 'high').length
  const summary = actionable > 0
    ? `Score de santé ${health.score}/100 (${health.grade}). ${actionable} point(s) urgent(s) à traiter en priorité.`
    : `Score de santé ${health.score}/100 (${health.grade}). Aucun point urgent détecté sur la période.`

  return {
    generatedAt: new Date().toISOString(),
    periodDays: m.periodDays,
    summary,
    healthScore: health.score,
    healthGrade: health.grade,
    insights,
    priorityActions,
    forecast: forecastWeeklyMargin(m),
    dataGaps,
  }
}
