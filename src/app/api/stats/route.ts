export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { subDays, format, eachDayOfInterval, parseISO } from 'date-fns'
import { calcTotalHT, calcTotalTTC, roundCents } from '@/lib/billing'
import { fromCents, toCents, lineCents, fromScaled } from '@/lib/money'
import { linesToEuros, intQtyLineCents } from '@/lib/money-db'
import { logger } from '@/lib/logger'

// GET /api/stats?period=7  (days, default 7)
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const period = Math.min(90, Math.max(1, Number(searchParams.get('period') ?? '7')))

  const endDate   = new Date()
  const startDate = subDays(endDate, period - 1)
  const startStr  = format(startDate, 'yyyy-MM-dd')
  const endStr    = format(endDate, 'yyyy-MM-dd')

  const garageId = session.user.garageId

  try {

  // Fetch everything in parallel — invoice query has separate error handling
  const [garage, mechanics, jobs, lowStockParts] = await Promise.all([
    prisma.garage.findUnique({ where: { id: garageId } }),

    prisma.mechanic.findMany({
      where: { garageId },
      orderBy: { order: 'asc' },
    }),

    prisma.job.findMany({
      where: {
        garageId,
        date: { gte: startStr, lte: endStr },
        status: { not: 'cancelled' },
      },
      include: {
        jobParts: { include: { part: true } },
        mechanic: true,
        // Identité RÉELLE du client, pour le classement (voir plus bas) :
        // `customerName` est du texte libre, saisi à chaque intervention.
        vehicle: { select: { clientId: true, client: { select: { name: true } } } },
      },
    }),

    prisma.part.findMany({ where: { garageId } }),
  ])

  // Invoice query in isolation — graceful fallback if Invoice table is unavailable
  let paidInvoices: Awaited<ReturnType<typeof prisma.invoice.findMany<{ include: { lines: true; job: { include: { mechanic: true } } } }>>> = []
  try {
    paidInvoices = await prisma.invoice.findMany({
      where: { garageId, status: 'paid', createdAt: { gte: startDate, lte: endDate } },
      include: { lines: true, job: { include: { mechanic: true } } },
    })
  } catch (e) {
    logger.warn('[stats] invoice query failed (graceful fallback)', e)
  }

  const hourlyRate          = garage ? fromScaled(garage.hourlyRateTenThousandths) : 60
  const workshopHoursPerDay = (garage?.workshopEndHour ?? 18) - (garage?.workshopStartHour ?? 8)

  // ── Paid invoice totals ───────────────────────────────────────────────────
  const invoiceRevenue  = paidInvoices.reduce((s, inv) => s + calcTotalTTC(linesToEuros(inv.lines), inv.taxRate), 0)
  const invoiceHT       = paidInvoices.reduce((s, inv) => s + calcTotalHT(linesToEuros(inv.lines)), 0)
  const invoiceCount    = paidInvoices.length

  // Map invoices by date for per-day breakdown
  const invoiceByDate = new Map<string, number>()
  for (const inv of paidInvoices) {
    const d = format(new Date(inv.createdAt), 'yyyy-MM-dd')
    invoiceByDate.set(d, (invoiceByDate.get(d) ?? 0) + calcTotalTTC(linesToEuros(inv.lines), inv.taxRate))
  }

  // ── Per-day stats ─────────────────────────────────────────────────────────
  const days = eachDayOfInterval({ start: startDate, end: endDate })
  const dailyStats = days.map(d => {
    const dateStr  = format(d, 'yyyy-MM-dd')
    const dayJobs  = jobs.filter(j => j.date === dateStr)
    const completed = dayJobs.filter(j => j.status === 'completed')

    // ── Cumul en CENTIMES, arrondi une seule fois (GF-036) ───────────────────
    // Chaque journée était arrondie à l'EURO (`Math.round`) puis les journées
    // étaient additionnées. Sept jours à 1 h 30 × 65 €/h font 682,50 € réels ;
    // arrondis jour par jour (98 €), ils en faisaient 686. Sur la fenêtre
    // maximale de 90 jours, la dérive atteint ±45 €, et une marge réelle de
    // 0,80 € disparaissait quand produit et coût s'arrondissaient au même euro.
    // `lib/money` pose la règle : les calculs financiers se font en entiers de
    // centimes, et l'arrondi vient EN DERNIER.
    const billedMinutes = completed.reduce((s, j) => s + (j.actualDuration ?? j.estimatedDuration), 0)
    const billedHours   = billedMinutes / 60
    const laborCents    = lineCents(hourlyRate, billedHours)

    const partsRevenueCents = dayJobs.reduce((s, j) =>
      s + j.jobParts.reduce((ps, jp) => ps + intQtyLineCents(jp.unitPriceTenThousandths, jp.quantity), 0), 0)
    const partsCostCents    = dayJobs.reduce((s, j) =>
      s + j.jobParts.reduce((ps, jp) => ps + intQtyLineCents(jp.unitCostTenThousandths, jp.quantity), 0), 0)

    // Invoice revenue for this specific day
    const dayInvoiceRevenue = invoiceByDate.get(dateStr) ?? 0

    const activeMechanics = mechanics.filter(m => !m.isAbsent).length || 1
    const availableMinutes = workshopHoursPerDay * 60 * activeMechanics
    const scheduledMinutes = dayJobs.reduce((s, j) => s + j.estimatedDuration, 0)
    const utilizationRate  = Math.min(100, Math.round((scheduledMinutes / availableMinutes) * 100))

    return {
      date:             dateStr,
      jobCount:         dayJobs.length,
      completedCount:   completed.length,
      billedHours:      Math.round(billedHours * 10) / 10,
      laborRevenue:     fromCents(laborCents),
      partsRevenue:     fromCents(partsRevenueCents),
      partsCost:        fromCents(partsCostCents),
      totalRevenue:     fromCents(laborCents + partsRevenueCents),
      invoiceRevenue:   Math.round(dayInvoiceRevenue), // ← paid invoice revenue
      utilizationRate,
    }
  })

  // ── Per-mechanic stats ────────────────────────────────────────────────────
  const mechanicStats = mechanics.map(m => {
    const mJobs      = jobs.filter(j => j.mechanic?.id === m.id)
    const completed  = mJobs.filter(j => j.status === 'completed')
    const billedMins = completed.reduce((s, j) => s + (j.actualDuration ?? j.estimatedDuration), 0)
    const billedHrs  = billedMins / 60

    const totalAvailableMins = period * workshopHoursPerDay * 60
    const utilizationRate    = Math.min(100, Math.round((billedMins / totalAvailableMins) * 100))

    const estimatedMins = completed.reduce((s, j) => s + j.estimatedDuration, 0)
    const actualMins    = completed.reduce((s, j) => s + (j.actualDuration ?? j.estimatedDuration), 0)
    const efficiency    = completed.length >= 2
      ? Math.round((estimatedMins / actualMins) * 100)
      : null

    // Invoices generated by this mechanic's jobs
    const mechanicInvoiceRevenue = paidInvoices
      .filter(inv => inv.job?.mechanic?.id === m.id)
      .reduce((s, inv) => s + calcTotalTTC(linesToEuros(inv.lines), inv.taxRate), 0)

    return {
      mechanicId:           m.id,
      mechanicName:         m.name,
      mechanicColor:        m.color,
      mechanicAvatar:       m.avatar,
      jobCount:             mJobs.length,
      completedCount:       completed.length,
      billedHours:          Math.round(billedHrs * 10) / 10,
      // Même règle que les journées : centimes exacts, arrondi en dernier.
      laborRevenue:         fromCents(lineCents(hourlyRate, billedHrs)),
      invoiceRevenue:       Math.round(mechanicInvoiceRevenue),
      utilizationRate,
      efficiency,
      avgEstimatedMins:     completed.length ? Math.round(estimatedMins / completed.length) : 0,
      avgActualMins:        completed.length ? Math.round(actualMins    / completed.length) : 0,
    }
  })

  // ── Global totals ─────────────────────────────────────────────────────────
  // Les cumuls repassent par les centimes : additionner des euros décimaux
  // réintroduirait, en flottant, l'imprécision que l'arrondi journalier venait
  // de créer en entier.
  const laborTotal  = fromCents(dailyStats.reduce((s, d) => s + toCents(d.laborRevenue),  0))
  const partsTotal  = fromCents(dailyStats.reduce((s, d) => s + toCents(d.partsRevenue),  0))
  const partsCTotal = fromCents(dailyStats.reduce((s, d) => s + toCents(d.partsCost),     0))

  const totals = {
    jobCount:         jobs.length,
    completedCount:   jobs.filter(j => j.status === 'completed').length,
    billedHours:      Math.round(dailyStats.reduce((s, d) => s + d.billedHours, 0) * 10) / 10,
    laborRevenue:     laborTotal,
    partsRevenue:     partsTotal,
    partsCost:        partsCTotal,
    partsMargin:      fromCents(toCents(partsTotal) - toCents(partsCTotal)),
    totalRevenue:     fromCents(toCents(laborTotal) + toCents(partsTotal)),
    // ── Invoice-based revenue (paid invoices = confirmed cash) ──
    invoiceRevenue:   Math.round(invoiceRevenue),  // TTC
    invoiceHT:        Math.round(invoiceHT),
    invoiceCount,
    // ── Le `max` annoncé est maintenant appliqué, sur DEUX grandeurs HT ──────
    // Le commentaire promettait « max(job-based, invoice-based) » ; le code
    // écrivait un ternaire, et surtout comparait le TTC des factures payées au
    // HT du planning. Dès qu'une seule facture était encaissée, la branche
    // « planning » disparaissait — un mois entier de travail pouvait se réduire
    // au montant de cette facture. `invoiceHT` est déjà calculé plus haut : les
    // deux grandeurs sont désormais comparables.
    confirmedRevenue: Math.round(Math.max(invoiceHT, laborTotal + partsTotal)),
    utilizationRate:  dailyStats.length
      ? Math.round(dailyStats.reduce((s, d) => s + d.utilizationRate, 0) / dailyStats.length)
      : 0,
  }

  // ── Stock alerts ──────────────────────────────────────────────────────────
  const stockAlerts = lowStockParts.filter(p => p.quantity <= p.minQuantity)

  // ── Top clients (by job count in period) ─────────────────────────────────
  // ── Le classement suit le CLIENT, plus l'orthographe de son nom (GF-036) ──
  // `customerName` est du texte libre, ressaisi à chaque intervention :
  // « Jean Dupont », « jean dupont » et « J. Dupont » comptaient pour trois
  // clients distincts, et aucun d'eux n'atteignait le podium. Renommer une
  // fiche client ne changeait rien non plus — rien ne propage vers `Job`.
  // L'identité fiable existe depuis GF-015 : intervention → véhicule → client,
  // dès qu'une plaque est saisie. Le repli sur le nom couvre l'historique et
  // les interventions sans plaque.
  const clientCounts = new Map<string, { name: string; count: number; revenue: number }>()
  for (const j of jobs) {
    const key = j.vehicle?.clientId ?? `nom:${j.customerName.trim().toLowerCase()}`
    const nom = j.vehicle?.client?.name ?? j.customerName
    const entry = clientCounts.get(key) ?? { name: nom, count: 0, revenue: 0 }
    entry.count++
    entry.revenue += j.jobParts.reduce((s, p) => s + fromCents(intQtyLineCents(p.unitPriceTenThousandths, p.quantity)), 0)
    clientCounts.set(key, entry)
  }
  const topClients = Array.from(clientCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // ── Top repair types (by count in period) ────────────────────────────────
  const typeCounts = new Map<string, { type: string; count: number }>()
  for (const j of jobs) {
    const entry = typeCounts.get(j.repairType) ?? { type: j.repairType, count: 0 }
    entry.count++
    typeCounts.set(j.repairType, entry)
  }
  const topRepairTypes = Array.from(typeCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return NextResponse.json({
    period,
    startDate: startStr,
    endDate:   endStr,
    hourlyRate,
    dailyStats,
    mechanicStats,
    totals,
    stockAlerts,
    topClients,
    topRepairTypes,
    recentInvoices: paidInvoices.slice(0, 10).map(inv => ({
      id:           inv.id,
      number:       inv.number,
      totalTTC:     roundCents(calcTotalTTC(linesToEuros(inv.lines), inv.taxRate)),
      customerName: inv.job?.customerName ?? inv.clientName ?? '—',
      createdAt:    inv.createdAt,
    })),
  })

  } catch (e) {
    logger.error('[stats] fatal error', e)
    // Return minimal valid response so the dashboard renders instead of erroring.
    // Aucun message technique dans la réponse — un code stable suffit à l'UI.
    return NextResponse.json({
      period, startDate: startStr, endDate: endStr, hourlyRate: 60,
      dailyStats: [], mechanicStats: [], stockAlerts: [], topClients: [], topRepairTypes: [],
      recentInvoices: [],
      totals: { jobCount: 0, completedCount: 0, billedHours: 0, laborRevenue: 0, partsRevenue: 0,
                partsCost: 0, partsMargin: 0, totalRevenue: 0, invoiceRevenue: 0, invoiceHT: 0,
                invoiceCount: 0, confirmedRevenue: 0, utilizationRate: 0 },
      error: 'Une erreur interne est survenue.', code: 'INTERNAL_ERROR',
    })
  }
})
