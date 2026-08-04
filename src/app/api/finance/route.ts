export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { calcTotalHT, calcTotalTTC } from '@/lib/billing'
import { subMonths, format, startOfMonth, endOfMonth } from 'date-fns'

// GET /api/finance?months=6
// Returns monthly revenue, margins, quote→invoice conversion rate
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const monthCount = Math.min(24, Math.max(1, Number(searchParams.get('months') ?? '6')))
  const garageId = session.user.garageId

  // Build month ranges
  const now = new Date()
  const months = Array.from({ length: monthCount }, (_, i) => {
    const d = subMonths(now, monthCount - 1 - i)
    return { label: format(d, 'MMM yyyy'), start: startOfMonth(d), end: endOfMonth(d) }
  })

  const [garage, allInvoices, allQuotes] = await Promise.all([
    prisma.garage.findUnique({ where: { id: garageId } }),

    prisma.invoice.findMany({
      where: { garageId, createdAt: { gte: months[0].start } },
      include: { lines: true },
    }),

    prisma.quote.findMany({
      where: { garageId, createdAt: { gte: months[0].start } },
      select: { id: true, status: true, createdAt: true },
    }),
  ])

  const hourlyRate = garage?.hourlyRate ?? 60

  const monthlyStats = months.map(({ label, start, end }) => {
    const invoices = allInvoices.filter(inv =>
      new Date(inv.createdAt) >= start && new Date(inv.createdAt) <= end
    )
    const paidInvoices = invoices.filter(inv => inv.status === 'paid')

    const caHT        = paidInvoices.reduce((s, inv) => s + calcTotalHT(inv.lines), 0)
    const caTTC       = paidInvoices.reduce((s, inv) => s + calcTotalTTC(inv.lines, inv.taxRate), 0)
    const tva         = caTTC - caHT

    // Marge pièces — POPULATIONS COHÉRENTES : le coût des pièces est calculé sur
    // EXACTEMENT les mêmes factures payées (même bucketing par date de facture)
    // qui composent le CA. On somme le coût (unitCost) des lignes NON main-d'œuvre
    // de ces factures. Auparavant le coût provenait de TOUTES les pièces
    // consommées (jobPart) filtrées par date d'intervention — population et
    // fenêtre temporelles différentes du CA (pièces d'un job non encore
    // facturé/payé), rendant la marge incohérente (jusqu'à négative ou > 100 %).
    // NB : la main-d'œuvre n'est pas déduite (marge « pièces » brute, par intention).
    const partsCost   = paidInvoices.reduce((s, inv) =>
      s + inv.lines
        .filter(l => !l.isLabor)
        .reduce((ls, l) => ls + l.unitCost * l.quantity, 0), 0)

    const quotesCreated  = allQuotes.filter(q => new Date(q.createdAt) >= start && new Date(q.createdAt) <= end)
    const quotesAccepted = quotesCreated.filter(q => ['accepted', 'converted'].includes(q.status))
    const conversionRate = quotesCreated.length > 0
      ? Math.round((quotesAccepted.length / quotesCreated.length) * 100)
      : null

    const margin = caHT > 0 ? Math.round(((caHT - partsCost) / caHT) * 100) : null

    return {
      label,
      caHT:            Math.round(caHT * 100) / 100,
      caTTC:           Math.round(caTTC * 100) / 100,
      tva:             Math.round(tva * 100) / 100,
      invoiceCount:    paidInvoices.length,
      partsCost:       Math.round(partsCost * 100) / 100,
      margin,
      quotesCreated:   quotesCreated.length,
      quotesAccepted:  quotesAccepted.length,
      conversionRate,
    }
  })

  // Totals over the full period
  const totalCAHT  = monthlyStats.reduce((s, m) => s + m.caHT, 0)
  const totalCATTC = monthlyStats.reduce((s, m) => s + m.caTTC, 0)
  const totalTVA   = monthlyStats.reduce((s, m) => s + m.tva, 0)
  const avgMargin  = monthlyStats.filter(m => m.margin !== null).reduce((s, m) => s + (m.margin ?? 0), 0)
    / (monthlyStats.filter(m => m.margin !== null).length || 1)
  const allQuotesInPeriod   = allQuotes.length
  const allAcceptedInPeriod = allQuotes.filter(q => ['accepted', 'converted'].includes(q.status)).length
  const globalConversion = allQuotesInPeriod > 0
    ? Math.round((allAcceptedInPeriod / allQuotesInPeriod) * 100)
    : null

  return NextResponse.json({
    months: monthlyStats,
    totals: {
      caHT:            Math.round(totalCAHT * 100) / 100,
      caTTC:           Math.round(totalCATTC * 100) / 100,
      tva:             Math.round(totalTVA * 100) / 100,
      avgMargin:       Math.round(avgMargin),
      globalConversion,
      invoiceCount:    monthlyStats.reduce((s, m) => s + m.invoiceCount, 0),
    },
    currency: garage?.currency ?? 'EUR',
    hourlyRate,
  })
})
