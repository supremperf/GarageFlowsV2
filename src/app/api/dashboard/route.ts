export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { fromScaled } from '@/lib/money'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { format, startOfDay, subDays, subMonths } from 'date-fns'
import { calcTotalHT, roundCents } from '@/lib/billing'
import { billingLines, linesToEuros } from '@/lib/money-db'
import { analyze } from '@/lib/profitability'
import { planReorders, type StockItemInput } from '@/lib/stock-forecast'
import { buildDashboard, type DashboardInsight, type KpiInput } from '@/lib/dashboard'

// GET /api/dashboard — decision dashboard: KPIs (trend + status), a composite
// health score, and prioritised insights. Read-only, garage-scoped.
export const GET = withAuth(async () => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const today = startOfDay(new Date())

  // Monthly revenue HT for the last 2 months (this vs previous).
  const monthKeys = [format(subMonths(today, 1), 'yyyy-MM'), format(today, 'yyyy-MM')]
  const since30 = format(subMonths(today, 1), 'yyyy-MM-dd')

  const [invoices2mo, prof, stock, pendingQuotes, overdueCount] = await Promise.all([
    prisma.invoice.findMany({
      where: { garageId, status: 'paid', issueDate: { gte: `${monthKeys[0]}-01` } },
      select: { issueDate: true, lines: { select: { quantityTenThousandths: true, unitPriceTenThousandths: true } } },
    }),
    profitability(garageId, since30),
    stockReport(garageId, today),
    prisma.quote.count({ where: { garageId, status: 'sent' } }),
    // Count overdue quotes with a date predicate (no unbounded row scan).
    prisma.quote.count({ where: { garageId, status: 'sent', createdAt: { lt: subDays(today, 30) } } }),
  ])

  // Revenue this month vs last month.
  const revByMonth = new Map<string, number>(monthKeys.map((k) => [k, 0]))
  for (const inv of invoices2mo) {
    const k = inv.issueDate.slice(0, 7)
    if (revByMonth.has(k)) revByMonth.set(k, revByMonth.get(k)! + calcTotalHT(billingLines(inv.lines)))
  }
  const revenueThis = roundCents(revByMonth.get(monthKeys[1]) ?? 0)
  const revenuePrev = roundCents(revByMonth.get(monthKeys[0]) ?? 0)

  const lowStockCount = stock.plans.filter((p) => p.shouldReorder).length
  const criticalStock = stock.plans.filter((p) => p.urgency === 'critical')

  // Margin is null when there are no paid invoices in the window — "unknown", not
  // 0%. Only attach thresholds (which drive good/warning/critical) when known, so
  // a quiet/new garage renders neutral rather than a false "critical".
  const marginKpi: KpiInput = prof.marginPct != null
    ? { key: 'margin', label: 'Marge (30 j)', value: prof.marginPct, unit: '%', direction: 'higher_better', warnAt: 20, critAt: 10, target: 30 }
    : { key: 'margin', label: 'Marge (30 j)', value: 0, unit: '%', direction: 'higher_better', target: 30 }

  const kpis: KpiInput[] = [
    { key: 'revenue', label: 'CA HT (mois)', value: revenueThis, previous: revenuePrev, unit: '€', direction: 'higher_better' },
    marginKpi,
    { key: 'lowstock', label: 'Pièces à réapprovisionner', value: lowStockCount, unit: '', direction: 'lower_better', warnAt: 3, critAt: 8 },
    { key: 'pending_quotes', label: 'Devis en attente', value: pendingQuotes, unit: '', direction: 'lower_better', warnAt: 10, critAt: 25 },
  ]

  const insights: DashboardInsight[] = []
  for (const a of prof.anomalies.slice(0, 5)) {
    insights.push({ id: `prof:${a.type}:${a.ref?.id ?? a.label}`, severity: a.severity, title: a.label, message: a.detail, source: 'profitability', metric: { amount: a.amount } })
  }
  if (criticalStock.length > 0) {
    insights.push({
      id: 'stock:critical',
      severity: 'critical',
      title: `${criticalStock.length} pièce(s) en rupture imminente`,
      message: `À commander sans délai : ${criticalStock.slice(0, 3).map((p) => p.name).join(', ')}${criticalStock.length > 3 ? '…' : ''}.`,
      source: 'stock',
      metric: { count: criticalStock.length, estimatedCost: stock.summary.totalOrderCost },
    })
  }
  if (overdueCount > 0) {
    insights.push({ id: 'quotes:overdue', severity: 'medium', title: `${overdueCount} devis sans réponse depuis > 30 j`, message: 'Relancer les clients pour améliorer le taux de conversion.', source: 'quotes', metric: { count: overdueCount } })
  }

  const dashboard = buildDashboard({
    kpis,
    insights,
    period: { label: format(today, 'MMMM yyyy'), from: `${monthKeys[1]}-01`, to: format(today, 'yyyy-MM-dd') },
  })

  return NextResponse.json(dashboard)
})

// ── Data gathering (garage-scoped) ─────────────────────────────────────────────
async function profitability(garageId: string, since: string) {
  const [invoices, jobParts] = await Promise.all([
    prisma.invoice.findMany({ where: { garageId, status: 'paid', issueDate: { gte: since } }, select: { id: true, number: true, status: true, lines: { select: { description: true, quantityTenThousandths: true, unitPriceTenThousandths: true, unitCostTenThousandths: true } } } }),
    prisma.jobPart.findMany({ where: { job: { garageId, date: { gte: since } } }, select: { partId: true, quantity: true, unitPriceTenThousandths: true, unitCostTenThousandths: true, part: { select: { name: true } } } }),
  ])
  const report = analyze({
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, status: i.status, lines: linesToEuros(i.lines) })),
    jobParts: jobParts.map((jp) => ({ partId: jp.partId, partName: jp.part?.name ?? '—', quantity: jp.quantity, unitPrice: fromScaled(jp.unitPriceTenThousandths), unitCost: fromScaled(jp.unitCostTenThousandths) })),
  })
  return { marginPct: report.totals.marginPct, anomalies: report.anomalies }
}

async function stockReport(garageId: string, today: Date) {
  const months = 6
  const keys = Array.from({ length: months }, (_, i) => format(subMonths(today, months - 1 - i), 'yyyy-MM'))
  const idx = new Map(keys.map((k, i) => [k, i]))
  const [parts, jobParts] = await Promise.all([
    prisma.part.findMany({ where: { garageId }, select: { id: true, name: true, reference: true, quantity: true, unitCostTenThousandths: true, minQuantity: true }, take: 5000 }),
    prisma.jobPart.findMany({ where: { job: { garageId, date: { gte: `${keys[0]}-01` } } }, select: { partId: true, quantity: true, job: { select: { date: true } } } }),
  ])
  const consumption = new Map<string, number[]>()
  for (const p of parts) consumption.set(p.id, new Array(months).fill(0))
  for (const jp of jobParts) { const arr = consumption.get(jp.partId); if (arr && jp.job) { const i = idx.get(jp.job.date.slice(0, 7)); if (i !== undefined) arr[i] += jp.quantity } }
  return planReorders(parts.map((p): { item: StockItemInput; consumption: number[] } => ({ item: { id: p.id, name: p.name, reference: p.reference, currentStock: p.quantity, unitCost: fromScaled(p.unitCostTenThousandths), minStock: p.minQuantity, leadTimeDays: 7, periodDays: 30 }, consumption: consumption.get(p.id) ?? [] })))
}
