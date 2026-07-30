export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { calcTotalHT, calcTotalTTC, roundCents } from '@/lib/billing'
import { runReport, reportToCsv, REPORT_SOURCES, isValidSource, type ReportSpec, type Row } from '@/lib/reports'

const SpecSchema = z.object({
  columns: z.array(z.string()).optional(),
  filters: z.array(z.object({ field: z.string(), op: z.string(), value: z.unknown() })).optional(),
  groupBy: z.array(z.string()).optional(),
  aggregations: z.array(z.object({ field: z.string(), fn: z.string(), as: z.string().optional() })).optional(),
  sort: z.array(z.object({ field: z.string(), dir: z.enum(['asc', 'desc']).optional() })).optional(),
  limit: z.number().int().min(0).max(100000).optional(),
})

async function loadRows(source: string, garageId: string): Promise<Row[]> {
  if (source === 'invoices') {
    const invoices = await prisma.invoice.findMany({
      where: { garageId },
      include: { lines: { select: { quantity: true, unitPrice: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return invoices.map((inv) => ({
      number: inv.number, status: inv.status, issueDate: inv.issueDate, clientName: inv.clientName,
      totalHT: roundCents(calcTotalHT(inv.lines)), totalTTC: roundCents(calcTotalTTC(inv.lines, inv.taxRate)), taxRate: inv.taxRate,
    }))
  }
  if (source === 'parts') {
    const parts = await prisma.part.findMany({ where: { garageId }, orderBy: { name: 'asc' } })
    return parts.map((p) => ({
      reference: p.reference, name: p.name, quantity: p.quantity, minQuantity: p.minQuantity,
      unitCost: p.unitCost, unitPrice: p.unitPrice, location: p.location,
    }))
  }
  if (source === 'clients') {
    const clients = await prisma.client.findMany({ where: { garageId }, orderBy: { name: 'asc' } })
    return clients.map((c) => ({
      name: c.name, email: c.email, phone: c.phone, address: c.address, createdAt: c.createdAt.toISOString().slice(0, 10),
    }))
  }
  // jobs
  const jobs = await prisma.job.findMany({
    where: { garageId },
    include: { mechanic: { select: { name: true } } },
    orderBy: { date: 'desc' },
    take: 5000,
  })
  return jobs.map((j) => ({
    date: j.date, customerName: j.customerName, vehicleModel: j.vehicleModel, licensePlate: j.licensePlate,
    repairType: j.repairType, status: j.status, estimatedDuration: j.estimatedDuration, mechanicName: j.mechanic?.name ?? '',
  }))
}

// GET /api/reports — available sources + their fields (for the report builder).
export const GET = withAuth(async () => {
  await requireSession()
  return NextResponse.json({ sources: REPORT_SOURCES })
})

// POST /api/reports?source=invoices&format=csv — run a report spec.
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const rl = await enforceRateLimit('api', `reports:${session.user.garageId}`, { max: 30, windowSec: 60 })
  if (!rl.ok) {
    return NextResponse.json({ error: `Trop de requêtes. Réessayez dans ${rl.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  }

  const { searchParams } = new URL(req.url)
  const source = searchParams.get('source') ?? 'invoices'
  const format = searchParams.get('format') ?? 'json'
  if (!isValidSource(source)) {
    return NextResponse.json({ error: `Source inconnue : ${source}` }, { status: 400 })
  }

  const parsed = SpecSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Spécification invalide', details: parsed.error.flatten() }, { status: 400 })
  }
  const spec = parsed.data as ReportSpec

  const rows = await loadRows(source, session.user.garageId)
  const result = runReport(spec, rows)

  if (format === 'csv') {
    const delimiter = searchParams.get('delimiter') ?? ','
    const csv = '﻿' + reportToCsv(result, { delimiter }) // BOM for Excel
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="rapport_${source}.csv"`,
      },
    })
  }

  return NextResponse.json(result)
})
