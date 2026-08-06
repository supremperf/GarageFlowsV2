export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { UpdateInvoiceSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { withTotals } from '@/lib/billing'
import { lineToScaled, linesToEuros } from '@/lib/money-db'
import { checkStatusTransition, areAmountsLocked, isDeletable } from '@/lib/document-status'

export const GET = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(withTotals({ ...invoice, lines: linesToEuros(invoice.lines) }))
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

  // A legally-issued invoice is immutable for amounts: block line/taxRate edits
  // once it leaves 'draft' (French sequential-invoice rules → use a credit note).
  const financialEdit = body.lines !== undefined || body.taxRate !== undefined
  if (financialEdit && areAmountsLocked('invoice', existing.status)) {
    return NextResponse.json(
      { error: 'Une facture émise ne peut plus être modifiée. Créez un avoir.' },
      { status: 409 },
    )
  }

  // Machine à états : une facture émise ne peut JAMAIS revenir à « draft »
  // (sinon le verrou d'immutabilité ci-dessus serait contournable en deux
  // appels : PATCH {status:'draft'} puis ré-édition/suppression).
  if (body.status !== undefined) {
    const transitionError = checkStatusTransition('invoice', existing.status, body.status)
    if (transitionError) return NextResponse.json({ error: transitionError }, { status: 409 })
  }

  // Replace lines + update the invoice atomically so a partial failure can never
  // leave the invoice with zero lines.
  const invoice = await prisma.$transaction(async (tx) => {
    if (body.lines !== undefined) {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: params.id } })
      await tx.invoiceLine.createMany({
        data: body.lines.map((l: { description: string; quantity: number; unitPrice: number; unitCost?: number; isLabor?: boolean; sortOrder?: number }, i: number) => ({
          invoiceId: params.id,
          description: l.description,
          ...lineToScaled(l), // saisie euros -> entiers exacts (dix-milliemes)
          isLabor: l.isLabor ?? false,
          sortOrder: l.sortOrder ?? i,
        })),
      })
    }
    return tx.invoice.update({
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
  })

  await logAudit({ action: 'update', entityType: 'Invoice', entityId: invoice.id, session, req })

  return NextResponse.json(withTotals({ ...invoice, lines: linesToEuros(invoice.lines) }))
})

export const DELETE = withAuth(async (req, { params }) => {
  const session = await requireSession()
  // Only draft invoices may be hard-deleted. An issued (sent/paid/overdue)
  // invoice must be preserved for the sequential series and accounting/FEC — it
  // is cancelled via a credit note, never erased.
  const existing = await prisma.invoice.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isDeletable('invoice', existing.status)) {
    return NextResponse.json(
      { error: 'Une facture émise ne peut pas être supprimée. Créez un avoir.' },
      { status: 409 },
    )
  }
  await prisma.invoice.delete({ where: { id: params.id, garageId: session.user.garageId } })
  await logAudit({ action: 'delete', entityType: 'Invoice', entityId: params.id, session, req })
  return NextResponse.json({ success: true })
})
