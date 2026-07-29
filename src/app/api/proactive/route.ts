export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { addDays, differenceInDays, format, parseISO, startOfDay, subMonths } from 'date-fns'
import { calcTotalTTC } from '@/lib/billing'
import { planReorders, type StockItemInput } from '@/lib/stock-forecast'
import { buildAlerts, type ProactiveInput } from '@/lib/proactive'

const WORKDAY_MIN = 8 * 60

// GET /api/proactive — prioritized proactive alerts composed from the engines.
export const GET = withAuth(async () => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const today = startOfDay(new Date())
  const input: ProactiveInput = {}

  // ── Predictive stock (reuse the stock-forecast engine) ──────────────────────
  try {
    const months = 6
    const startDate = format(subMonths(today, months - 1), 'yyyy-MM-01')
    const keys = Array.from({ length: months }, (_, i) => format(subMonths(today, months - 1 - i), 'yyyy-MM'))
    const idx = new Map(keys.map((k, i) => [k, i]))
    const [parts, jobParts] = await Promise.all([
      prisma.part.findMany({ where: { garageId }, select: { id: true, name: true, reference: true, quantity: true, unitCost: true, minQuantity: true } }),
      prisma.jobPart.findMany({ where: { job: { garageId, date: { gte: startDate } } }, select: { partId: true, quantity: true, job: { select: { date: true } } } }),
    ])
    const consumption = new Map<string, number[]>()
    for (const p of parts) consumption.set(p.id, new Array(months).fill(0))
    for (const jp of jobParts) {
      const arr = consumption.get(jp.partId)
      if (arr && jp.job) { const i = idx.get(jp.job.date.slice(0, 7)); if (i !== undefined) arr[i] += jp.quantity }
    }
    const report = planReorders(parts.map((p): { item: StockItemInput; consumption: number[] } => ({
      item: { id: p.id, name: p.name, reference: p.reference, currentStock: p.quantity, unitCost: p.unitCost, minStock: p.minQuantity, leadTimeDays: 7, periodDays: 30 },
      consumption: consumption.get(p.id) ?? [],
    })))
    input.stock = report.plans
      .filter((pl) => pl.urgency === 'critical' || pl.urgency === 'high')
      .map((pl) => ({ name: pl.name, urgency: pl.urgency, daysToStockout: pl.daysToStockout, recommendedOrderQty: pl.recommendedOrderQty, estimatedCost: pl.estimatedCost, ref: pl.id }))
  } catch { /* stock signal optional */ }

  // ── Invoices → overdue + VIP recall ─────────────────────────────────────────
  try {
    const invoices = await prisma.invoice.findMany({
      where: { garageId },
      select: { id: true, number: true, status: true, clientId: true, clientName: true, issueDate: true, dueDate: true, taxRate: true, lines: { select: { quantity: true, unitPrice: true } } },
    })
    const overdue = []
    const byClient = new Map<string, { name: string; total: number; last: string }>()
    for (const inv of invoices) {
      const ttc = calcTotalTTC(inv.lines, inv.taxRate)
      if (inv.status !== 'paid' && inv.status !== 'draft' && inv.dueDate) {
        const days = differenceInDays(today, parseISO(inv.dueDate))
        if (days > 0) overdue.push({ id: inv.id, number: inv.number, clientName: inv.clientName ?? '—', amount: ttc, overdueDays: days })
      }
      if (inv.clientId) {
        const cur = byClient.get(inv.clientId) ?? { name: inv.clientName ?? '—', total: 0, last: inv.issueDate }
        cur.total += ttc
        if (inv.issueDate > cur.last) cur.last = inv.issueDate
        byClient.set(inv.clientId, cur)
      }
    }
    input.overdue = overdue
    input.vip = Array.from(byClient.entries()).map(([id, c]) => ({
      id, name: c.name, totalSpent: c.total, lastVisitDays: differenceInDays(today, parseISO(c.last)),
    }))
  } catch { /* optional */ }

  // ── Pending quotes ──────────────────────────────────────────────────────────
  try {
    const quotes = await prisma.quote.findMany({
      where: { garageId, status: 'sent' },
      select: { id: true, number: true, clientName: true, createdAt: true, taxRate: true, lines: { select: { quantity: true, unitPrice: true } } },
    })
    input.quotes = quotes.map((q) => ({
      id: q.id, number: q.number, clientName: q.clientName, ageDays: differenceInDays(today, startOfDay(q.createdAt)), amount: calcTotalTTC(q.lines, q.taxRate),
    }))
  } catch { /* optional */ }

  // ── Tomorrow's mechanic overload ────────────────────────────────────────────
  try {
    const tomorrow = format(addDays(today, 1), 'yyyy-MM-dd')
    const [jobs, mechanics] = await Promise.all([
      prisma.job.findMany({ where: { garageId, date: tomorrow, status: { not: 'completed' } }, select: { mechanicId: true, estimatedDuration: true, delayMinutes: true } }),
      prisma.mechanic.findMany({ where: { garageId }, select: { id: true, name: true } }),
    ])
    const load = new Map<string, number>()
    for (const j of jobs) load.set(j.mechanicId, (load.get(j.mechanicId) ?? 0) + (j.estimatedDuration ?? 0) + (j.delayMinutes ?? 0))
    input.overload = mechanics
      .map((m) => ({ id: m.id, name: m.name, utilizationPct: Math.round(((load.get(m.id) ?? 0) / WORKDAY_MIN) * 100), date: tomorrow }))
      .filter((o) => o.utilizationPct >= 100)
  } catch { /* optional */ }

  // ── CT expiring ─────────────────────────────────────────────────────────────
  try {
    const vehicles = await prisma.vehicle.findMany({ where: { garageId, ctDate: { not: null } }, select: { id: true, licensePlate: true, ctDate: true } })
    input.ct = vehicles
      .map((v) => ({ id: v.id, plate: v.licensePlate, daysLeft: differenceInDays(parseISO(v.ctDate!), today) }))
      .filter((c) => c.daysLeft <= 30)
  } catch { /* optional */ }

  const alerts = buildAlerts(input)
  const byType: Record<string, number> = {}
  for (const a of alerts) byType[a.type] = (byType[a.type] ?? 0) + 1

  return NextResponse.json({ alerts, summary: { total: alerts.length, byType } })
})
