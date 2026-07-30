export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { UpdateInvoiceSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { withTotals } from '@/lib/billing'

export const GET = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(withTotals(invoice))
})

export const PATCH = withAuth(async (req, { params }) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = UpdateInvoiceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  // Verify ownership before touching child records
  const existing = await prisma.invoice.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Legal immutability (FR): once an invoice leaves 'draft' its amounts are
  // frozen. Status transitions (sent → paid) and non-financial fields stay
  // editable, but lines and the tax rate cannot change — corrections require a
  // credit note (avoir).
  if (existing.status !== 'draft' && (body.lines !== undefined || body.taxRate !== undefined)) {
    return NextResponse.json(
      { error: 'Facture finalisée : les lignes et le taux de TVA ne peuvent plus être modifiés. Créez un avoir pour corriger.' },
      { status: 409 }
    )
  }

  if (body.lines !== undefined) {
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: params.id } })
    await prisma.invoiceLine.createMany({
      data: body.lines.map((l: { description: string; quantity: number; unitPrice: number; unitCost?: number; isLabor?: boolean; sortOrder?: number }, i: number) => ({
        invoiceId: params.id,
        description: l.description,
        quantity: l.quantity ?? 1,
        unitPrice: l.unitPrice ?? 0,
        unitCost: l.unitCost ?? 0,
        isLabor: l.isLabor ?? false,
        sortOrder: l.sortOrder ?? i,
      })),
    })
  }

  const invoice = await prisma.invoice.update({
    where: { id: params.id, garageId: session.user.garageId },
    data: {
      ...(body.status !== undefined && { status: body.status }),
      ...(body.clientName !== undefined && { clientName: body.clientName }),
      ...(body.clientEmail !== undefined && { clientEmail: body.clientEmail }),
      ...(body.clientPhone !== undefined && { clientPhone: body.clientPhone }),
      ...(body.clientAddress !== undefined && { clientAddress: body.clientAddress }),
      ...(body.vehicleModel !== undefined && { vehicleModel: body.vehicleModel }),
      ...(body.licensePlate !== undefined && { licensePlate: body.licensePlate }),
      ...(body.dueDate !== undefined && { dueDate: body.dueDate }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.taxRate !== undefined && { taxRate: body.taxRate }),
    },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })

  await logAudit({ action: 'update', entityType: 'Invoice', entityId: invoice.id, session, req })

  return NextResponse.json(withTotals(invoice))
})

export const DELETE = withAuth(async (req, { params }) => {
  const session = await requireSession()

  // Only drafts may be deleted. Deleting an issued invoice would create a gap in
  // the legally-required continuous numbering sequence — issue a credit note
  // (avoir) instead.
  const existing = await prisma.invoice.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    select: { id: true, status: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'draft') {
    return NextResponse.json(
      { error: 'Seules les factures en brouillon peuvent être supprimées. Créez un avoir pour annuler une facture émise.' },
      { status: 409 }
    )
  }

  await prisma.invoice.delete({ where: { id: params.id, garageId: session.user.garageId } })
  await logAudit({ action: 'delete', entityType: 'Invoice', entityId: params.id, session, req })
  return NextResponse.json({ success: true })
})
