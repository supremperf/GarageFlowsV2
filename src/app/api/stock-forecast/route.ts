export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { fromScaled } from '@/lib/money'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can, redactReorderCosts } from '@/lib/authz'
import { subMonths, format } from 'date-fns'
import { planReorders, type StockItemInput } from '@/lib/stock-forecast'

// GET /api/stock-forecast?months=6&leadTimeDays=7
// Predictive reorder plan per part, from JobPart consumption history.
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const { searchParams } = new URL(req.url)
  const months = Math.min(24, Math.max(2, Number(searchParams.get('months') ?? '6')))
  const leadTimeDays = Math.min(90, Math.max(1, Number(searchParams.get('leadTimeDays') ?? '7')))

  const monthKeys = Array.from({ length: months }, (_, i) => format(subMonths(new Date(), months - 1 - i), 'yyyy-MM'))
  const monthIndex = new Map(monthKeys.map((k, i) => [k, i]))
  const startDate = `${monthKeys[0]}-01`

  const [parts, jobParts, garage] = await Promise.all([
    prisma.part.findMany({
      where: { garageId },
      select: { id: true, name: true, reference: true, quantity: true, unitCostTenThousandths: true, minQuantity: true },
    }),
    prisma.jobPart.findMany({
      where: { job: { garageId, date: { gte: startDate } } },
      select: { partId: true, quantity: true, job: { select: { date: true } } },
    }),
    prisma.garage.findUnique({ where: { id: garageId }, select: { currency: true } }),
  ])

  // Per-part monthly consumption buckets.
  const consumption = new Map<string, number[]>()
  for (const p of parts) consumption.set(p.id, new Array(months).fill(0))
  for (const jp of jobParts) {
    const arr = consumption.get(jp.partId)
    if (!arr || !jp.job) continue
    const i = monthIndex.get(jp.job.date.slice(0, 7))
    if (i !== undefined) arr[i] += jp.quantity
  }

  const items = parts.map((p) => {
    const item: StockItemInput = {
      id: p.id,
      name: p.name,
      reference: p.reference,
      currentStock: p.quantity,
      unitCost: fromScaled(p.unitCostTenThousandths),
      minStock: p.minQuantity,
      leadTimeDays,
      periodDays: 30,
    }
    return { item, consumption: consumption.get(p.id) ?? [] }
  })

  const report = planReorders(items, garage?.currency ?? 'EUR')

  // Le coût d'achat révèle la marge : même projection que sur les lignes de
  // devis et de facture (GF31-AUD-009) et que sur la réponse du copilote. Cette
  // route rendait `estimatedCost` par pièce ET `totalOrderCost` en résumé à tout
  // utilisateur authentifié — le contrôle posé sur /api/finance et
  // /api/profitability se contournait donc en la lisant.
  //
  // Le plan lui-même reste rendu : la quantité à commander et l'urgence sont des
  // informations d'atelier.
  if (!can(session.user.role, 'financial:read')) {
    const { totalOrderCost: _cout, ...resume } = report.summary
    return NextResponse.json({
      plans: redactReorderCosts(report.plans as unknown as Record<string, unknown>[], session.user.role),
      summary: resume,
    })
  }
  return NextResponse.json(report)
})
