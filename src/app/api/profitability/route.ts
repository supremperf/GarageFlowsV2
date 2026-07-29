export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { subMonths, format } from 'date-fns'
import { analyze, type AnalyzedInvoice, type AnalyzedJobPart, type PartStock } from '@/lib/profitability'

// GET /api/profitability?months=6 — margin breakdowns + anomalies + recommendations.
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const { searchParams } = new URL(req.url)
  const months = Math.min(24, Math.max(1, Number(searchParams.get('months') ?? '6')))
  const startStr = format(subMonths(new Date(), months - 1), 'yyyy-MM-01')

  const [rawInvoices, rawJobParts, rawParts, garage] = await Promise.all([
    prisma.invoice.findMany({
      where: { garageId, status: 'paid', issueDate: { gte: startStr } },
      include: {
        lines: { select: { description: true, quantity: true, unitPrice: true, unitCost: true, isLabor: true } },
        client: { select: { id: true, name: true } },
        vehicle: { select: { id: true, make: true } },
        job: { select: { mechanic: { select: { id: true, name: true } } } },
      },
    }),
    prisma.jobPart.findMany({
      where: { job: { garageId, date: { gte: startStr } } },
      include: { part: { select: { name: true } } },
    }),
    prisma.part.findMany({
      where: { garageId },
      select: { id: true, name: true, reference: true, quantity: true, unitCost: true, unitPrice: true },
    }),
    prisma.garage.findUnique({ where: { id: garageId }, select: { currency: true } }),
  ])

  const invoices: AnalyzedInvoice[] = rawInvoices.map((inv) => ({
    id: inv.id,
    number: inv.number,
    status: inv.status,
    clientId: inv.clientId,
    clientName: inv.client?.name ?? inv.clientName ?? null,
    vehicleId: inv.vehicleId,
    make: inv.vehicle?.make ?? null,
    mechanicId: inv.job?.mechanic?.id ?? null,
    mechanicName: inv.job?.mechanic?.name ?? null,
    lines: inv.lines,
  }))

  const jobParts: AnalyzedJobPart[] = rawJobParts.map((jp) => ({
    partId: jp.partId,
    partName: jp.part?.name ?? '—',
    quantity: jp.quantity,
    unitPrice: jp.unitPrice,
    unitCost: jp.unitCost,
  }))

  const parts: PartStock[] = rawParts as PartStock[]

  const report = analyze({ invoices, jobParts, parts, currency: garage?.currency ?? 'EUR' })
  return NextResponse.json(report)
})
