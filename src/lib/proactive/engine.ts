/**
 * Proactive assistant — compose signals into prioritized, actionable alerts.
 */
import type {
  AlertSeverity,
  ProactiveAlert,
  ProactiveInput,
  ProactiveOptions,
} from './types'

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function buildAlerts(input: ProactiveInput, opts: ProactiveOptions = {}): ProactiveAlert[] {
  const quoteAgeDays = opts.quoteAgeDays ?? 5
  const vipMinSpent = opts.vipMinSpent ?? 1000
  const vipMinInactiveDays = opts.vipMinInactiveDays ?? 120

  const alerts: ProactiveAlert[] = []

  // ── Predictive stock ────────────────────────────────────────────────────────
  for (const s of input.stock ?? []) {
    if (s.urgency !== 'critical' && s.urgency !== 'high') continue
    const when = s.daysToStockout != null ? `dans ~${s.daysToStockout} jour(s)` : 'prochainement'
    alerts.push({
      id: `stock:${s.ref ?? s.name}`,
      type: 'stock_out_soon',
      severity: s.urgency === 'critical' ? 'critical' : 'high',
      title: 'Rupture de stock imminente',
      message: `Le stock « ${s.name} » sera probablement épuisé ${when}.`,
      actionLabel: `Commander ${s.recommendedOrderQty}`,
      amount: s.estimatedCost != null ? round2(s.estimatedCost) : undefined,
      ref: { id: s.ref, label: s.name },
    })
  }

  // ── Pending quotes ──────────────────────────────────────────────────────────
  for (const q of input.quotes ?? []) {
    if (q.ageDays < quoteAgeDays) continue
    alerts.push({
      id: `quote:${q.id ?? q.number}`,
      type: 'quote_pending',
      severity: q.amount >= 1000 ? 'high' : 'medium',
      title: 'Devis en attente',
      message: `Le devis ${q.number} (${q.clientName}) attend une réponse depuis ${q.ageDays} jour(s).`,
      actionLabel: 'Relancer le client',
      amount: round2(q.amount),
      ref: { id: q.id, label: q.number },
    })
  }

  // ── Mechanic overload ───────────────────────────────────────────────────────
  for (const o of input.overload ?? []) {
    if (o.utilizationPct < 100) continue
    alerts.push({
      id: `overload:${o.id ?? o.name}:${o.date}`,
      type: 'mechanic_overload',
      severity: o.utilizationPct >= 130 ? 'critical' : 'high',
      title: 'Mécanicien surchargé',
      message: `${o.name} sera surchargé le ${o.date} (${o.utilizationPct}% de charge).`,
      actionLabel: 'Rééquilibrer le planning',
      ref: { id: o.id, label: o.name },
    })
  }

  // ── Overdue invoices ────────────────────────────────────────────────────────
  for (const o of input.overdue ?? []) {
    alerts.push({
      id: `overdue:${o.id ?? o.number}`,
      type: 'invoice_overdue',
      severity: o.overdueDays >= 30 ? 'critical' : 'high',
      title: 'Facture impayée',
      message: `La facture ${o.number} (${o.clientName}) est impayée depuis ${o.overdueDays} jour(s).`,
      actionLabel: 'Relancer',
      amount: round2(o.amount),
      ref: { id: o.id, label: o.number },
    })
  }

  // ── Contrôle technique ──────────────────────────────────────────────────────
  for (const c of input.ct ?? []) {
    alerts.push({
      id: `ct:${c.id ?? c.plate}`,
      type: 'ct_expiring',
      severity: c.daysLeft <= 0 ? 'critical' : c.daysLeft <= 15 ? 'high' : 'medium',
      title: 'Contrôle technique',
      message:
        c.daysLeft <= 0
          ? `Le contrôle technique de ${c.plate} est expiré.`
          : `Le contrôle technique de ${c.plate} expire dans ${c.daysLeft} jour(s).`,
      actionLabel: 'Prévenir le client',
      ref: { id: c.id, label: c.plate },
    })
  }

  // ── VIP recall ──────────────────────────────────────────────────────────────
  for (const v of input.vip ?? []) {
    if (v.totalSpent < vipMinSpent || v.lastVisitDays < vipMinInactiveDays) continue
    alerts.push({
      id: `vip:${v.id ?? v.name}`,
      type: 'vip_recall',
      severity: 'medium',
      title: 'Client VIP à rappeler',
      message: `Le client VIP « ${v.name} » n'est pas venu depuis ${v.lastVisitDays} jour(s) — à rappeler.`,
      actionLabel: 'Rappeler',
      amount: round2(v.totalSpent),
      ref: { id: v.id, label: v.name },
    })
  }

  alerts.sort((a, b) => {
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    return (b.amount ?? 0) - (a.amount ?? 0)
  })

  return alerts
}
