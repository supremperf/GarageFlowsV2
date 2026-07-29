export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { format } from 'date-fns'
import { withTotals } from '@/lib/billing'
import { CreateInvoiceSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'

// GET /api/invoices
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('jobId')
  const status = searchParams.get('status')

  const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20')))
  const skip  = (page - 1) * limit

  const where: Record<string, unknown> = { garageId: session.user.garageId }
  if (jobId) where.jobId = jobId
  if (status) where.status = status

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        lines: { orderBy: { sortOrder: 'asc' } },
        job: { select: { id: true, customerName: true, vehicleModel: true, licensePlate: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.invoice.count({ where }),
  ])

  // Compute totals from lines (no stored computed columns in SQLite)
  const data = invoices.map(inv => {
    return withTotals(inv)
  })
  return NextResponse.json({ data, total, page, totalPages: Math.ceil(total / limit), limit })
})

// POST /api/invoices
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = CreateInvoiceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  // Derive the fiscal year from the resolved issueDate (the accounting date the
  // FEC export filters on), not the server clock — a back-dated invoice must be
  // numbered in its own year. Allocate the counter and create the invoice in ONE
  // transaction so a failed create rolls the counter back (no sequence gaps).
  const issueDate = body.issueDate ?? format(new Date(), 'yyyy-MM-dd')
  const year = new Date(issueDate).getFullYear()

  const invoice = await prisma.$transaction(async (tx) => {
    const garage = await tx.garage.update({
      where: { id: session.user.garageId },
      data: { invoiceCounter: { increment: 1 } },
    })
    const number = `${garage.invoicePrefix}-${year}-${String(garage.invoiceCounter).padStart(3, '0')}`

    return tx.invoice.create({
      data: {
        number,
        garageId: session.user.garageId,
        clientId: body.clientId ?? null,
        vehicleId: body.vehicleId ?? null,
        jobId: body.jobId ?? null,
        clientName: body.clientName ?? '',
        clientEmail: body.clientEmail ?? null,
        clientPhone: body.clientPhone ?? null,
        clientAddress: body.clientAddress ?? null,
        vehicleModel: body.vehicleModel ?? null,
        licensePlate: body.licensePlate ?? null,
        status: 'draft',
        issueDate,
        dueDate: body.dueDate ?? null,
        notes: body.notes ?? null,
        taxRate: body.taxRate ?? garage.taxRate,
        lines: {
          create: (body.lines ?? []).map((l: { description: string; quantity: number; unitPrice: number; unitCost?: number; isLabor?: boolean; sortOrder?: number }, i: number) => ({
            description: l.description,
            quantity: l.quantity ?? 1,
            unitPrice: l.unitPrice ?? 0,
            unitCost: l.unitCost ?? 0,
            isLabor: l.isLabor ?? false,
            sortOrder: l.sortOrder ?? i,
          })),
        },
      },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    })
  })

  await logAudit({ action: 'create', entityType: 'Invoice', entityId: invoice.id, session, req })

  return NextResponse.json(invoice, { status: 201 })
})
