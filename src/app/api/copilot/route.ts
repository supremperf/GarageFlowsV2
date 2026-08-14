export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { fromScaled } from '@/lib/money'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { differenceInDays, format, startOfDay, subMonths } from 'date-fns'
import { calcTotalHT, roundCents } from '@/lib/billing'
import { billingLines, linesToEuros } from '@/lib/money-db'
import { handleQuery, type CopilotResponse } from '@/lib/copilot'
import { analyze } from '@/lib/profitability'
import { forecast } from '@/lib/forecast'
import { diagnose } from '@/lib/diagnostic'
import { vinEngine } from '@/lib/vin'
import { planReorders, type StockItemInput } from '@/lib/stock-forecast'
import { phraseAnswer, resolveLlmProvider } from '@/lib/copilot-llm'

const BodySchema = z.object({ query: z.string().trim().min(1).max(500) })

// Résolveurs exposant des données FINANCIÈRES (CA, marge, revenu par client,
// prévision de CA) — réservés à financial:read (OWNER/MANAGER). Les intentions
// opérationnelles (mécaniciens dispo, VIN, diagnostic, retards…) restent
// ouvertes à tous les rôles authentifiés.
const FINANCIAL_RESOLVERS = new Set(['margin', 'revenue_today', 'top_clients', 'forecast'])

// POST /api/copilot — conversational routing over the platform's engines.
// Read intents are answered with real data; action intents return a
// confirmation-gated proposal (the copilot NEVER performs a write itself).
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const rl = await enforceRateLimit('api', `copilot:${garageId}`, { max: 60, windowSec: 60 })
  if (!rl.ok) {
    return NextResponse.json({ error: `Trop de requêtes. Réessayez dans ${rl.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  }

  const parsed = BodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'query requis' }, { status: 400 })

  const res: CopilotResponse = handleQuery(parsed.data.query)

  // Actions & unknown pass through unchanged (actions require confirmation).
  if (res.type !== 'answer' || !res.resolver) return NextResponse.json(res)

  // Contrôle d'accès financier : une intention financière posée par un rôle sans
  // financial:read est refusée (pas de fuite de CA/marge via le copilote).
  if (FINANCIAL_RESOLVERS.has(res.resolver) && !can(session.user.role, 'financial:read')) {
    return NextResponse.json({ error: 'Accès refusé : données financières réservées.' }, { status: 403 })
  }

  const today = startOfDay(new Date())
  const todayStr = format(today, 'yyyy-MM-dd')

  try {
    switch (res.resolver) {
      case 'quotes_pending': {
        const quotes = await prisma.quote.findMany({
          where: { garageId, status: 'sent' }, select: { number: true, clientName: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 50,
        })
        res.data = quotes.map((q) => ({ number: q.number, clientName: q.clientName, ageDays: differenceInDays(today, startOfDay(q.createdAt)) }))
        res.message = quotes.length ? `${quotes.length} devis en attente de réponse.` : 'Aucun devis en attente.'
        break
      }
      case 'revenue_today': {
        const invoices = await prisma.invoice.findMany({ where: { garageId, status: 'paid', issueDate: todayStr }, select: { lines: { select: { quantityTenThousandths: true, unitPriceTenThousandths: true } } } })
        const ht = roundCents(invoices.reduce((s, inv) => s + calcTotalHT(billingLines(inv.lines)), 0))
        res.data = { revenueHT: ht, invoiceCount: invoices.length, date: todayStr }
        res.message = `Chiffre d'affaires HT du jour : ${ht} € sur ${invoices.length} facture(s) payée(s).`
        break
      }
      case 'margin': {
        const since = format(subMonths(today, 1), 'yyyy-MM-dd')
        const [invoices, jobParts] = await Promise.all([
          prisma.invoice.findMany({ where: { garageId, status: 'paid', issueDate: { gte: since } }, select: { id: true, number: true, status: true, lines: { select: { description: true, quantityTenThousandths: true, unitPriceTenThousandths: true, unitCostTenThousandths: true } } } }),
          prisma.jobPart.findMany({ where: { job: { garageId, date: { gte: since } } }, select: { partId: true, quantity: true, unitPriceTenThousandths: true, unitCostTenThousandths: true, part: { select: { name: true } } } }),
        ])
        const report = analyze({
          invoices: invoices.map((i) => ({ id: i.id, number: i.number, status: i.status, lines: linesToEuros(i.lines) })),
          jobParts: jobParts.map((jp) => ({ partId: jp.partId, partName: jp.part?.name ?? '—', quantity: jp.quantity, unitPrice: fromScaled(jp.unitPriceTenThousandths), unitCost: fromScaled(jp.unitCostTenThousandths) })),
        })
        res.data = report.totals
        res.message = `Sur 30 jours : marge ${report.totals.margin} € (${report.totals.marginPct ?? 0}%) pour ${report.totals.revenueHT} € de CA HT.`
        break
      }
      case 'low_stock': {
        const report = await stockReport(garageId, today)
        const toOrder = report.plans.filter((p) => p.shouldReorder)
        res.data = toOrder.slice(0, 20)
        res.message = toOrder.length ? `${toOrder.length} pièce(s) à réapprovisionner (coût estimé ${report.summary.totalOrderCost} €).` : 'Aucune pièce à commander.'
        break
      }
      case 'forecast': {
        const series = await monthlyRevenue(garageId, today, 12)
        const f = forecast(series, { horizon: 1 })
        res.data = { history: series, forecast: f }
        res.message = `Prévision du CA du mois prochain : ~${f.points[0]?.value ?? 0} € (tendance ${f.trend}, confiance ${f.confidence}).`
        break
      }
      case 'top_clients': {
        const invoices = await prisma.invoice.findMany({ where: { garageId, status: 'paid' }, select: { clientId: true, clientName: true, lines: { select: { quantityTenThousandths: true, unitPriceTenThousandths: true } } } })
        const by = new Map<string, { name: string; total: number }>()
        for (const inv of invoices) {
          const k = inv.clientId ?? inv.clientName ?? '—'
          const cur = by.get(k) ?? { name: inv.clientName ?? '—', total: 0 }
          cur.total = roundCents(cur.total + calcTotalHT(billingLines(inv.lines)))
          by.set(k, cur)
        }
        res.data = Array.from(by.values()).sort((a, b) => b.total - a.total).slice(0, 5)
        res.message = 'Vos meilleurs clients par chiffre d\'affaires.'
        break
      }
      case 'available_mechanics': {
        const mechs = await prisma.mechanic.findMany({ where: { garageId, isAbsent: false }, select: { name: true } })
        res.data = mechs.map((m) => m.name)
        res.message = `${mechs.length} mécanicien(s) disponible(s) : ${mechs.map((m) => m.name).join(', ') || '—'}.`
        break
      }
      case 'late_vehicles': {
        const jobs = await prisma.job.findMany({ where: { garageId, date: todayStr, status: { not: 'completed' }, delayMinutes: { gt: 0 } }, select: { customerName: true, vehicleModel: true, licensePlate: true, delayMinutes: true } })
        res.data = jobs
        res.message = jobs.length ? `${jobs.length} véhicule(s) en retard aujourd'hui.` : 'Aucun véhicule en retard aujourd\'hui.'
        break
      }
      case 'diagnostic': {
        const result = diagnose({ symptoms: res.slots.text ? [res.slots.text] : [], obdCodes: res.slots.obdCode ? [res.slots.obdCode] : [] })
        res.data = result
        res.message = result.causes.length ? `Cause la plus probable : ${result.causes[0].name} (${result.causes[0].probability}%).` : 'Précisez un symptôme ou un code défaut.'
        break
      }
      case 'vin': {
        if (!res.slots.vin) { res.type = 'clarify'; res.message = 'Indiquez le VIN (17 caractères) à décoder.'; break }
        const decoded = await vinEngine.decode(res.slots.vin).catch(() => null)
        res.data = decoded
        res.message = decoded ? `${res.slots.vin} : ${decoded.manufacturer ?? 'constructeur inconnu'}, ${decoded.modelYear ?? '?'} (${decoded.country ?? '—'}).` : 'VIN invalide.'
        break
      }
      case 'proactive': {
        const report = await stockReport(garageId, today)
        const stock = report.plans.filter((p) => p.urgency === 'critical' || p.urgency === 'high').length
        const quotes = await prisma.quote.count({ where: { garageId, status: 'sent' } })
        res.data = { lowStockUrgent: stock, pendingQuotes: quotes }
        // Renvoyer l'utilisateur vers « /api/proactive » l'envoyait dans une
        // impasse : c'est une route d'API, qu'aucun écran n'expose et qu'un
        // garagiste ne peut pas ouvrir. Le copilote dit ce qu'il sait, et
        // désigne l'écran qui existe réellement.
        res.message = `Priorités : ${stock} pièce(s) en risque de rupture, ${quotes} devis en attente. `
          + 'Le détail des ruptures est dans le panneau Stock, onglet « stock bas ».'
        break
      }
      default:
        res.message = 'Intention reconnue mais non encore câblée.'
    }
  } catch (e) {
    console.error('[copilot] resolver error', e)
    res.message = 'Erreur lors de la récupération des données.'
  }

  // Optional natural-language phrasing. With no provider configured this returns
  // res.message verbatim; a configured provider's phrasing is grounding-checked
  // against the deterministic MESSAGE only. Grounding against the whole res.data
  // blob would let a fabricated figure launder through an incidental internal
  // number (an id, a date, leadTimeDays, a per-row reorderPoint, …).
  const phrased = await phraseAnswer({ query: parsed.data.query, facts: res.message ?? '', fallback: res.message ?? '' }, resolveLlmProvider())
  return NextResponse.json({ ...res, phrasing: phrased.text })
})

// ── Shared helpers ────────────────────────────────────────────────────────────
async function monthlyRevenue(garageId: string, today: Date, months: number): Promise<number[]> {
  const keys = Array.from({ length: months }, (_, i) => format(subMonths(today, months - 1 - i), 'yyyy-MM'))
  const idx = new Map(keys.map((k, i) => [k, i]))
  const values = new Array(months).fill(0)
  const invoices = await prisma.invoice.findMany({ where: { garageId, status: 'paid', issueDate: { gte: `${keys[0]}-01` } }, select: { issueDate: true, lines: { select: { quantityTenThousandths: true, unitPriceTenThousandths: true } } } })
  for (const inv of invoices) { const i = idx.get(inv.issueDate.slice(0, 7)); if (i !== undefined) values[i] += calcTotalHT(billingLines(inv.lines)) }
  return values.map((v) => roundCents(v))
}

async function stockReport(garageId: string, today: Date) {
  const months = 6
  const keys = Array.from({ length: months }, (_, i) => format(subMonths(today, months - 1 - i), 'yyyy-MM'))
  const idx = new Map(keys.map((k, i) => [k, i]))
  const [parts, jobParts] = await Promise.all([
    prisma.part.findMany({ where: { garageId }, select: { id: true, name: true, reference: true, quantity: true, unitCostTenThousandths: true, minQuantity: true } }),
    prisma.jobPart.findMany({ where: { job: { garageId, date: { gte: `${keys[0]}-01` } } }, select: { partId: true, quantity: true, job: { select: { date: true } } } }),
  ])
  const consumption = new Map<string, number[]>()
  for (const p of parts) consumption.set(p.id, new Array(months).fill(0))
  for (const jp of jobParts) { const arr = consumption.get(jp.partId); if (arr && jp.job) { const i = idx.get(jp.job.date.slice(0, 7)); if (i !== undefined) arr[i] += jp.quantity } }
  return planReorders(parts.map((p): { item: StockItemInput; consumption: number[] } => ({ item: { id: p.id, name: p.name, reference: p.reference, currentStock: p.quantity, unitCost: fromScaled(p.unitCostTenThousandths), minStock: p.minQuantity, leadTimeDays: 7, periodDays: 30 }, consumption: consumption.get(p.id) ?? [] })))
}
