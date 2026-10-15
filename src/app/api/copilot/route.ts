export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { fromScaled } from '@/lib/money'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can, redactReorderCosts } from '@/lib/authz'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { differenceInDays, format, startOfDay, subMonths } from 'date-fns'
import { calcTotalHT, roundCents } from '@/lib/billing'
import { billingLines, linesToEuros } from '@/lib/money-db'
import { ConversationSchema, understand } from '@/lib/copilot/conversation'
import { KNOWLEDGE, KNOWLEDGE_VERSION } from '@/lib/copilot/knowledge'
import { providerHealth } from '@/lib/copilot-llm/provider'
import { logger } from '@/lib/logger'
import { analyze } from '@/lib/profitability'
import { forecast } from '@/lib/forecast'
import { diagnose } from '@/lib/diagnostic'
import { vinEngine } from '@/lib/vin'
import { planReorders, type StockItemInput } from '@/lib/stock-forecast'
import { phraseAnswer, resolveLlmProvider } from '@/lib/copilot-llm'

// Authenticated readiness snapshot: no paid probe, no credential exposure.
export const GET = withAuth(async () => {
  await requireSession()
  const model = providerHealth()
  return NextResponse.json({ state: model.state === 'ready' ? 'ready' : 'degraded',
    local: { state: 'ready', knowledgeVersion: KNOWLEDGE_VERSION, articles: KNOWLEDGE.length },
    model, database: 'not_probed',
    message: 'Aide locale disponible. Chaque lecture métier vérifie ses données au moment de la demande.' },
    { headers: { 'Cache-Control': 'private, no-store' } })
})

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

  // Bound actual streamed bytes, not just an optional Content-Length header.
  const reader = req.body?.getReader()
  if (!reader) return NextResponse.json({ error: 'Corps JSON requis' }, { status: 400 })
  let raw = ''
  let bytes = 0
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 20000) { await reader.cancel(); return NextResponse.json({ error: 'Demande trop volumineuse' }, { status: 413 }) }
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()
  } finally { reader.releaseLock() }
  let body: unknown
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }
  const parsed = ConversationSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Demande ou contexte invalide (question : 500 caractères, historique : 6 questions maximum).' }, { status: 400 })

  const res = await understand(parsed.data, session.user.role, resolveLlmProvider())

  // Actions & unknown pass through unchanged (actions require confirmation).
  if (res.type !== 'answer' || !res.resolver) return NextResponse.json(res)

  // Contrôle d'accès financier : une intention financière posée par un rôle sans
  // financial:read est refusée (pas de fuite de CA/marge via le copilote).
  if (FINANCIAL_RESOLVERS.has(res.resolver) && !can(session.user.role, 'financial:read')) {
    return NextResponse.json({ error: 'Accès refusé : données financières réservées.' }, { status: 403 })
  }

  const today = startOfDay(new Date())
  const todayStr = format(today, 'yyyy-MM-dd')

  // Le panneau affiche un écusson « Chiffres ancrés sur les données · vérifié ».
  // Cette affirmation n'a de sens que si la réponse porte VRAIMENT des données du
  // garage. Ces deux drapeaux distinguent les réponses qui n'en portent aucune —
  // une panne de lecture, ou une demande de précision — de celles qui en portent.
  let erreurResolveur = false
  let demandeDePrecision = false

  try {
    switch (res.resolver) {
      case 'job_search': {
        // Independently recheck the permission at the tool boundary. No IDs/tenant from model/history.
        if (!can(session.user.role, 'job:manage')) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
        const reference = res.slots.text?.trim()
        if (!reference || reference.length < 2 || reference.length > 60) {
          res.type = 'clarify'; res.message = 'Précisez un nom ou une immatriculation.'; break
        }
        const plate = /^[A-Z]{2}-[0-9]{3}-[A-Z]{2}$/.test(reference)
        const jobs = await prisma.job.findMany({
          where: { garageId, ...(plate ? { licensePlate: { in: [reference, reference.replace(/-/g, ''), reference.replace(/-/g, ' ')] } } : { customerName: { contains: reference } }) },
          select: { id: true, customerName: true, licensePlate: true, vehicleModel: true, repairType: true, date: true, status: true, delayMinutes: true },
          orderBy: [{ date: 'desc' }, { id: 'asc' }], take: 6,
        })
        // Never select free-text notes, contacts, costs or documents. Records are data, not instructions.
        res.data = { jobs: jobs.slice(0, 5), hasMore: jobs.length > 5, observedAt: new Date().toISOString() }
        res.message = jobs.length
          ? jobs.slice(0, 5).map(j => `${j.customerName} — ${j.licensePlate || 'sans immatriculation'} — ${j.vehicleModel} — ${j.date} — ${j.status} — retard déclaré : ${j.delayMinutes == null ? 'non renseigné' : `${j.delayMinutes} min`}.`).join('\n')
            + (jobs.length > 5 ? '\nRésultats limités à 5 : précisez la référence.' : '')
            + '\nLes causes du retard ne sont pas établies par ces seuls champs. Aucun dossier modifié.'
          : 'Aucune intervention correspondante dans votre garage. Vérifiez la référence ; ce résultat ne prouve pas l’absence d’une fiche client.'
        break
      }
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
        // Le coût d'achat est une donnée financière : il révèle la marge
        // (GF31-AUD-009). `low_stock` ne figure pas dans FINANCIAL_RESOLVERS —
        // à raison, savoir quelles pièces manquent est un besoin d'atelier — mais
        // il en livrait le PRIX. La porte de /api/finance se contournait donc en
        // demandant au copilote « quelles pièces sont en rupture ? ».
        // Remède déjà retenu pour les lignes de documents : retirer le champ,
        // pas refuser la réponse.
        const voitLesCouts = can(session.user.role, 'financial:read')
        res.data = redactReorderCosts(toOrder.slice(0, 20) as unknown as Record<string, unknown>[], session.user.role)
        res.message = toOrder.length
          ? (voitLesCouts
            ? `${toOrder.length} pièce(s) à réapprovisionner (coût estimé ${report.summary.totalOrderCost} €).`
            : `${toOrder.length} pièce(s) à réapprovisionner.`)
          : 'Aucune pièce à commander.'
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
        // Sans symptôme ni code, il n'y a pas de diagnostic : c'est une demande
        // de précision, pas une réponse tirée des données.
        demandeDePrecision = result.causes.length === 0
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
    logger.warn('[copilot] resolver failed', { resolver: res.resolver })
    void e
    erreurResolveur = true
    res.message = 'Erreur lors de la récupération des données.'
  }

  // Optional natural-language phrasing. With no provider configured this returns
  // res.message verbatim; a configured provider's phrasing is grounding-checked
  // against the deterministic MESSAGE only. Grounding against the whole res.data
  // blob would let a fabricated figure launder through an incidental internal
  // number (an id, a date, leadTimeDays, a per-row reorderPoint, …).
  const phrased = await phraseAnswer({ query: parsed.data.query, facts: res.message ?? '', fallback: res.message ?? '' }, resolveLlmProvider())

  // ── Ce que l'écusson « vérifié » a le droit d'affirmer ──────────────────────
  //
  // Il affirmait jusqu'ici la seule chose que le client savait voir : que le
  // champ `phrasing` existait. Or il existe TOUJOURS sur ce chemin. L'écusson
  // s'affichait donc sous « Erreur lors de la récupération des données. », sous
  // « Intention reconnue mais non encore câblée. » et sous une demande de VIN —
  // des phrases qui ne portent aucun chiffre du garage. Le seul signal de
  // confiance de l'interface ne signalait rien.
  //
  // On ne peut pas non plus se fier à `phrased.grounded` : il vaut `false`
  // précisément quand le garde-fou a REJETÉ une reformulation inventée et rendu
  // le texte déterministe — c'est-à-dire au moment où la réponse est la plus
  // sûre. S'y fier inverserait le signal.
  //
  // Le bon critère est celui-ci : un résolveur a-t-il réellement lu les données
  // de CE garage, et le texte affiché est-il soit ce calcul déterministe, soit
  // une reformulation qui a passé le contrôle d'ancrage ?
  //
  // Des quatre clauses, deux seulement décident aujourd'hui : `demandeDePrecision`
  // et `res.data != null`. Une épreuve par mutation le montre — sur une panne
  // comme sur une demande de VIN, `res.data` n'est de toute façon jamais assignée.
  // `erreurResolveur` et le contrôle de type sont conservés délibérément : ils
  // énoncent la règle, et couvrent le jour où un résolveur posera ses données
  // AVANT de lever, ou basculera son type après les avoir posées.
  const porteDesDonnees =
    !erreurResolveur && !demandeDePrecision && res.type === 'answer' && res.data != null

  return NextResponse.json({
    ...res,
    phrasing: phrased.text,
    execution: { readOnly: true, resolver: res.resolver, status: erreurResolveur ? 'failed' : demandeDePrecision || res.type === 'clarify' ? 'needs_input' : 'completed', observedAt: new Date().toISOString() },
    // `source` est propagée pour que la provenance cesse d'être indevinable :
    // 'fallback' = calcul déterministe, 'llm' = reformulation ancrée acceptée,
    // 'fallback_ungrounded' = reformulation rejetée, texte déterministe rendu.
    ancrage: { verifie: porteDesDonnees, source: phrased.source },
  })
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
