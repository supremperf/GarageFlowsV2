/**
 * Profitability analytics — pure, deterministic computations.
 */
import type {
  AnalyzedInvoice,
  AnalyzedJobPart,
  AnalyzeInput,
  Anomaly,
  DimensionMargin,
  Margin,
  PartMargin,
  PartStock,
  ProfitabilityReport,
} from './types'

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  const sign = n < 0 ? -1 : 1
  return (sign * Math.round(Math.abs(n) * 100 + 1e-6)) / 100
}

function pct(margin: number, revenue: number): number | null {
  if (revenue === 0) return null
  return Math.round((margin / revenue) * 1000) / 10 // one decimal, e.g. 23.4 (%)
}

export function lineMargin(line: { quantity: number; unitPrice: number; unitCost: number }): Margin {
  const revenueHT = line.quantity * line.unitPrice
  const costHT = line.quantity * line.unitCost
  const margin = revenueHT - costHT
  return { revenueHT: round2(revenueHT), costHT: round2(costHT), margin: round2(margin), marginPct: pct(margin, revenueHT) }
}

export function invoiceMargin(inv: AnalyzedInvoice): Margin {
  let revenue = 0
  let cost = 0
  for (const l of inv.lines) {
    revenue += l.quantity * l.unitPrice
    cost += l.quantity * l.unitCost
  }
  const margin = revenue - cost
  return { revenueHT: round2(revenue), costHT: round2(cost), margin: round2(margin), marginPct: pct(margin, revenue) }
}

/** Aggregate invoice margins by an arbitrary dimension selector. */
export function byDimension(
  invoices: AnalyzedInvoice[],
  selector: (inv: AnalyzedInvoice) => { key: string; label: string } | null,
): DimensionMargin[] {
  const acc = new Map<string, DimensionMargin>()
  for (const inv of invoices) {
    const dim = selector(inv)
    if (!dim) continue
    const m = invoiceMargin(inv)
    const cur =
      acc.get(dim.key) ??
      { key: dim.key, label: dim.label, revenueHT: 0, costHT: 0, margin: 0, marginPct: null, count: 0 }
    cur.revenueHT = round2(cur.revenueHT + m.revenueHT)
    cur.costHT = round2(cur.costHT + m.costHT)
    cur.margin = round2(cur.margin + m.margin)
    cur.count += 1
    acc.set(dim.key, cur)
  }
  const out = Array.from(acc.values())
  for (const d of out) d.marginPct = pct(d.margin, d.revenueHT)
  return out.sort((a, b) => b.margin - a.margin)
}

/** Aggregate margin per part from job-part sales. */
export function marginByPart(jobParts: AnalyzedJobPart[]): PartMargin[] {
  const acc = new Map<string, PartMargin>()
  for (const jp of jobParts) {
    const cur =
      acc.get(jp.partId) ??
      { partId: jp.partId, partName: jp.partName, qtySold: 0, revenueHT: 0, costHT: 0, margin: 0, marginPct: null }
    cur.qtySold += jp.quantity
    cur.revenueHT = round2(cur.revenueHT + jp.quantity * jp.unitPrice)
    cur.costHT = round2(cur.costHT + jp.quantity * jp.unitCost)
    cur.margin = round2(cur.revenueHT - cur.costHT)
    acc.set(jp.partId, cur)
  }
  const out = Array.from(acc.values())
  for (const p of out) p.marginPct = pct(p.margin, p.revenueHT)
  return out.sort((a, b) => b.margin - a.margin)
}

/** Parts in stock (qty>0) that had no sale in the period → tied-up capital. */
export function detectDormantStock(parts: PartStock[], soldPartIds: Set<string>): Anomaly[] {
  return parts
    .filter((p) => p.quantity > 0 && !soldPartIds.has(p.id))
    .map<Anomaly>((p) => {
      const amount = round2(p.quantity * p.unitCost)
      return {
        type: 'dormant_stock',
        severity: amount >= 500 ? 'high' : amount >= 100 ? 'medium' : 'low',
        label: `Stock dormant : ${p.name}`,
        detail: `${p.quantity} en stock, aucune vente sur la période — ${amount} € immobilisés.`,
        amount,
        ref: { id: p.id, name: p.name },
      }
    })
    .sort((a, b) => b.amount - a.amount)
}

export function analyze(input: AnalyzeInput): ProfitabilityReport {
  const currency = input.currency ?? 'EUR'
  const lowMarginPct = input.thresholds?.lowMarginPct ?? 0.1
  const invoices = input.invoices
  const jobParts = input.jobParts ?? []
  const parts = input.parts ?? []

  // Totals
  let revenue = 0
  let cost = 0
  const invoiceRows = invoices.map((inv) => {
    const m = invoiceMargin(inv)
    revenue += m.revenueHT
    cost += m.costHT
    return { id: inv.id, number: inv.number, ...m }
  })
  const totalMargin = round2(revenue - cost)
  const totals = {
    revenueHT: round2(revenue),
    costHT: round2(cost),
    margin: totalMargin,
    marginPct: pct(revenue - cost, revenue),
    invoiceCount: invoices.length,
  }

  const byClient = byDimension(invoices, (i) => (i.clientId ? { key: i.clientId, label: i.clientName ?? i.clientId } : null))
  const byVehicle = byDimension(invoices, (i) => (i.vehicleId ? { key: i.vehicleId, label: i.vehicleId } : null))
  const byMake = byDimension(invoices, (i) => (i.make ? { key: i.make, label: i.make } : null))
  const byMechanic = byDimension(invoices, (i) => (i.mechanicId ? { key: i.mechanicId, label: i.mechanicName ?? i.mechanicId } : null))
  const byPart = marginByPart(jobParts)

  // ── Anomalies ──────────────────────────────────────────────────────────────
  const anomalies: Anomaly[] = []
  const soldPartIds = new Set(jobParts.map((jp) => jp.partId))
  anomalies.push(...detectDormantStock(parts, soldPartIds))

  for (const row of invoiceRows) {
    if (row.marginPct === null) continue
    if (row.margin < 0) {
      anomalies.push({
        type: 'negative_margin_invoice',
        severity: 'high',
        label: `Facture à perte : ${row.number}`,
        detail: `Marge ${row.margin} € (${row.marginPct}%).`,
        amount: Math.abs(row.margin),
        ref: { id: row.id, name: row.number },
      })
    } else if (row.marginPct < lowMarginPct * 100) {
      anomalies.push({
        type: 'low_margin_invoice',
        severity: 'medium',
        label: `Marge faible : ${row.number}`,
        detail: `Marge ${row.marginPct}% (< ${Math.round(lowMarginPct * 100)}%).`,
        amount: round2(row.margin),
        ref: { id: row.id, name: row.number },
      })
    }
  }

  for (const c of byClient) {
    if (c.margin < 0) {
      anomalies.push({
        type: 'deficit_client',
        severity: 'high',
        label: `Client déficitaire : ${c.label}`,
        detail: `Marge cumulée ${c.margin} € sur ${c.count} facture(s).`,
        amount: Math.abs(c.margin),
        ref: { id: c.key, name: c.label },
      })
    }
  }

  for (const p of byPart) {
    if (p.margin < 0) {
      anomalies.push({
        type: 'negative_margin_part',
        severity: 'medium',
        label: `Pièce vendue à perte : ${p.partName}`,
        detail: `Marge ${p.margin} € sur ${p.qtySold} unité(s) — prix de vente probablement sous le coût.`,
        amount: Math.abs(p.margin),
        ref: { id: p.partId, name: p.partName },
      })
    }
  }

  anomalies.sort((a, b) => b.amount - a.amount)

  // ── Recommendations ──────────────────────────────────────────────────────────
  const recommendations: string[] = []
  const dormant = anomalies.filter((a) => a.type === 'dormant_stock')
  if (dormant.length) {
    const tied = round2(dormant.reduce((s, a) => s + a.amount, 0))
    recommendations.push(
      `${dormant.length} pièce(s) dormante(s) immobilisent ${tied} € — envisagez une promotion, un retour fournisseur ou l'arrêt du réapprovisionnement.`,
    )
  }
  const deficits = anomalies.filter((a) => a.type === 'deficit_client')
  if (deficits.length) {
    recommendations.push(
      `${deficits.length} client(s) déficitaire(s) — revoir la tarification, les remises accordées ou les temps facturés.`,
    )
  }
  const lowOrNeg = anomalies.filter((a) => a.type === 'low_margin_invoice' || a.type === 'negative_margin_invoice')
  if (lowOrNeg.length) {
    recommendations.push(
      `${lowOrNeg.length} facture(s) à marge faible ou négative — vérifier les coûts pièces/main-d'œuvre et les remises.`,
    )
  }
  const negParts = anomalies.filter((a) => a.type === 'negative_margin_part')
  if (negParts.length) {
    recommendations.push(
      `${negParts.length} pièce(s) vendue(s) à perte — corriger les prix de vente (marge cible) dans le catalogue.`,
    )
  }

  return {
    currency,
    totals,
    byClient,
    byVehicle,
    byMake,
    byMechanic,
    byPart,
    invoices: invoiceRows,
    anomalies,
    recommendations,
  }
}
