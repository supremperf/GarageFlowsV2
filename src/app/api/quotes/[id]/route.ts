export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { UpdateQuoteSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { withTotals } from '@/lib/billing'
import { lineToScaled, linesToEuros } from '@/lib/money-db'
import { checkStatusTransition, areAmountsLocked, isDeletable } from '@/lib/document-status'

// GET /api/quotes/[id]
export const GET = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  const quote = await prisma.quote.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(withTotals({ ...quote, lines: linesToEuros(quote.lines) }))
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

  // Un devis accepté/converti engage le client : ses montants (lignes, TVA)
  // sont figés — le corriger passe par un nouveau devis.
  const financialEdit = body.lines !== undefined || body.taxRate !== undefined
  if (financialEdit && areAmountsLocked('quote', existing.status)) {
    return NextResponse.json(
      { error: 'Un devis accepté ne peut plus être modifié. Créez un nouveau devis.' },
      { status: 409 },
    )
  }

  // Machine à états : pas de retour à « draft » ni de sortie d'un état terminal.
  if (body.status !== undefined) {
    const transitionError = checkStatusTransition('quote', existing.status, body.status)
    if (transitionError) return NextResponse.json({ error: transitionError }, { status: 409 })
  }

  // Remplacement des lignes + mise à jour du devis dans UNE transaction : un
  // échec partiel ne peut jamais laisser le devis avec zéro ligne.
  const quote = await prisma.$transaction(async (tx) => {
    if (body.lines !== undefined) {
      await tx.quoteLine.deleteMany({ where: { quoteId: params.id } })
      await tx.quoteLine.createMany({
        data: body.lines.map((l: { description: string; quantity: number; unitPrice: number; unitCost?: number; isLabor?: boolean; sortOrder?: number }, i: number) => ({
          quoteId: params.id,
          description: l.description,
          ...lineToScaled(l), // saisie euros -> entiers exacts (dix-milliemes)
          isLabor: l.isLabor ?? false,
          sortOrder: l.sortOrder ?? i,
        })),
      })
    }
    return tx.quote.update({
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
  })

  await logAudit({ action: 'update', entityType: 'Quote', entityId: quote.id, session, req })

  return NextResponse.json(withTotals({ ...quote, lines: linesToEuros(quote.lines) }))
})

// DELETE /api/quotes/[id]
export const DELETE = withAuth(async (req, { params }) => {
  const session = await requireSession()
  // Portée garage + verrou de statut : un devis accepté ou converti (référencé
  // par une facture, engagement client) n'est pas supprimable.
  const existing = await prisma.quote.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isDeletable('quote', existing.status)) {
    return NextResponse.json(
      { error: 'Un devis accepté ou converti ne peut pas être supprimé.' },
      { status: 409 },
    )
  }
  await prisma.quote.delete({ where: { id: params.id, garageId: session.user.garageId } })
  await logAudit({ action: 'delete', entityType: 'Quote', entityId: params.id, session, req })
  return NextResponse.json({ success: true })
})
