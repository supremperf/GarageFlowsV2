export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { UpdateQuoteSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { withTotals } from '@/lib/billing'

// GET /api/quotes/[id]
export const GET = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  const quote = await prisma.quote.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(withTotals(quote))
})

// PATCH /api/quotes/[id]
export const PATCH = withAuth(async (req, { params }) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = UpdateQuoteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  // Verify ownership before touching child records
  const existing = await prisma.quote.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Replace lines if provided
  if (body.lines !== undefined) {
    await prisma.quoteLine.deleteMany({ where: { quoteId: params.id } })
    await prisma.quoteLine.createMany({
      data: body.lines.map((l: { description: string; quantity: number; unitPrice: number; unitCost?: number; isLabor?: boolean; sortOrder?: number }, i: number) => ({
        quoteId: params.id,
        description: l.description,
        quantity: l.quantity ?? 1,
        unitPrice: l.unitPrice ?? 0,
        unitCost: l.unitCost ?? 0,
        isLabor: l.isLabor ?? false,
        sortOrder: l.sortOrder ?? i,
      })),
    })
  }

  const quote = await prisma.quote.update({
    where: { id: params.id, garageId: session.user.garageId },
    data: {
      ...(body.status !== undefined && { status: body.status }),
      ...(body.clientName !== undefined && { clientName: body.clientName }),
      ...(body.clientEmail !== undefined && { clientEmail: body.clientEmail }),
      ...(body.clientPhone !== undefined && { clientPhone: body.clientPhone }),
      ...(body.clientAddress !== undefined && { clientAddress: body.clientAddress }),
      ...(body.vehicleModel !== undefined && { vehicleModel: body.vehicleModel }),
      ...(body.licensePlate !== undefined && { licensePlate: body.licensePlate }),
      ...(body.validUntil !== undefined && { validUntil: body.validUntil }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.taxRate !== undefined && { taxRate: body.taxRate }),
    },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })

  await logAudit({ action: 'update', entityType: 'Quote', entityId: quote.id, session, req })

  return NextResponse.json(withTotals(quote))
})

// DELETE /api/quotes/[id]
export const DELETE = withAuth(async (req, { params }) => {
  const session = await requireSession()
  await prisma.quote.delete({ where: { id: params.id, garageId: session.user.garageId } })
  await logAudit({ action: 'delete', entityType: 'Quote', entityId: params.id, session, req })
  return NextResponse.json({ success: true })
})
