export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { format } from 'date-fns'
import { CreateQuoteSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { withTotals } from '@/lib/billing'

// GET /api/quotes
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

  const [quotes, total] = await Promise.all([
    prisma.quote.findMany({
      where,
      include: {
        lines: { orderBy: { sortOrder: 'asc' } },
        job: { select: { id: true, customerName: true, vehicleModel: true, licensePlate: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.quote.count({ where }),
  ])

  const data = quotes.map(q => {
    return withTotals(q)
  })
  return NextResponse.json({ data, total, page, totalPages: Math.ceil(total / limit), limit })
})

// POST /api/quotes
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = CreateQuoteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  // Allocate the counter and create the quote in ONE transaction (year from the
  // resolved issueDate) so a failed create rolls the counter back — no gaps.
  const issueDate = body.issueDate ?? format(new Date(), 'yyyy-MM-dd')
  const year = new Date(issueDate).getFullYear()

  const quote = await prisma.$transaction(async (tx) => {
    const garage = await tx.garage.update({
      where: { id: session.user.garageId },
      data: { quoteCounter: { increment: 1 } },
    })
    const number = `${garage.quotePrefix}-${year}-${String(garage.quoteCounter).padStart(3, '0')}`

    return tx.quote.create({
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
        validUntil: body.validUntil ?? null,
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

  await logAudit({ action: 'create', entityType: 'Quote', entityId: quote.id, session, req })

  return NextResponse.json(quote, { status: 201 })
})
