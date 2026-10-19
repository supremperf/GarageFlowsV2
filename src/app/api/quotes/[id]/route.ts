export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma, isPostgresDatabase } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { redactLineCosts } from '@/lib/authz'
import { UpdateQuoteSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { withTotals } from '@/lib/billing'
import { lineToScaled, linesToEuros } from '@/lib/money-db'
import { checkStatusTransition, areAmountsLocked, isDeletable } from '@/lib/document-status'
import { collectPartIds, findForeignPartIds } from '@/lib/stock/invoice-stock'

// GET /api/quotes/[id]
export const GET = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  const quote = await prisma.quote.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Coût d'achat retiré pour les rôles sans `financial:read` (GF31-AUD-009).
  return NextResponse.json(
    withTotals({ ...quote, lines: redactLineCosts(linesToEuros(quote.lines), session.user.role) }),
  )
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

  // SECURITY (IDOR) — une ligne ne peut référencer qu'une pièce de CE garage.
  const foreignParts = await findForeignPartIds(prisma, session.user.garageId, collectPartIds(parsed.data.lines))
  if (foreignParts.length > 0) {
    return NextResponse.json({ error: 'Pièce inconnue dans le stock de ce garage', code: 'PART_NOT_FOUND' }, { status: 400 })
  }

  // Remplacement des lignes + mise à jour du devis dans UNE transaction : un
  // échec partiel ne peut jamais laisser le devis avec zéro ligne.
  let lockConflict = false
  const quote = await prisma.$transaction(async (tx) => {
    // ANTI-TOCTOU : le verrou d'immutabilité et la transition sont RE-CONTRÔLÉS
    // DANS la transaction sur l'état COURANT. Le contrôle hors transaction plus
    // haut lit un statut potentiellement périmé : si le client ACCEPTE le devis
    // (portail) entre cette lecture et l'écriture, un PATCH « draft » périmé
    // réécrirait sinon les lignes d'un devis accepté. Miroir de invoices/[id].
    // Verrou de LIGNE avant la relecture : sans lui, la relecture reste un
    // simple `findFirst`, donc non bloquante. Sous PostgreSQL en READ COMMITTED,
    // le PATCH et l'acceptation depuis le portail lisent alors tous deux l'état
    // « draft » et franchissent le verrou (GF31-AUD-010). Même dispositif que
    // PATCH /api/admin/licenses/[id].
    if (isPostgresDatabase()) {
      await tx.$executeRaw`SELECT "id" FROM "Quote" WHERE "id" = ${params.id} FOR UPDATE`
    }
    const fresh = await tx.quote.findFirst({ where: { id: params.id, garageId: session.user.garageId }, select: { status: true } })
    if (fresh) {
      if (financialEdit && areAmountsLocked('quote', fresh.status)) { lockConflict = true; return null }
      if (body.status !== undefined && checkStatusTransition('quote', fresh.status, body.status)) { lockConflict = true; return null }
    }
    if (body.lines !== undefined) {
      await tx.quoteLine.deleteMany({ where: { quoteId: params.id } })
      await tx.quoteLine.createMany({
        data: body.lines.map((l: { description: string; quantity: number; unitPrice: number; unitCost?: number; isLabor?: boolean; sortOrder?: number; partId?: string | null }, i: number) => ({
          quoteId: params.id,
          description: l.description,
          ...lineToScaled(l), // saisie euros -> entiers exacts (dix-milliemes)
          isLabor: l.isLabor ?? false,
          sortOrder: l.sortOrder ?? i,
          // Lien vers la pièce (validé ci-dessus) — un devis n'engage pas le stock.
          partId: l.isLabor ? null : (l.partId ?? null),
        })),
      })
    }
    // ── PREUVE D'ACCEPTATION PÉRIMÉE (§74) ────────────────────────────────────
    // Une preuve n'est jamais supprimée, seulement marquée.
    // La preuve atteste UNE décision sur UN contenu. Toute sortie de cet état la
    // périme — y compris `accepted → refused`, où le garage transformerait sinon
    // un accord client en refus tout en conservant la preuve de l'accord.
    // Seule exception : `accepted → converted`, suite naturelle de l'accord, à
    // contenu inchangé.
    const quitteEtatSigne =
      body.status !== undefined &&
      !!fresh &&
      ['accepted', 'refused'].includes(fresh.status) &&
      body.status !== fresh.status &&
      !(fresh.status === 'accepted' && body.status === 'converted')
    if (quitteEtatSigne) {
      await tx.signature.updateMany({
        where: {
          garageId: session.user.garageId,
          entityType: 'quote',
          entityId: params.id,
          invalidatedAt: null,
        },
        data: { invalidatedAt: new Date() },
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

  if (lockConflict) {
    return NextResponse.json(
      { error: 'Un devis accepté ne peut plus être modifié. Créez un nouveau devis.' },
      { status: 409 },
    )
  }
  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await logAudit({ action: 'update', entityType: 'Quote', entityId: quote.id, session, req })

  return NextResponse.json(withTotals({ ...quote, lines: redactLineCosts(linesToEuros(quote.lines), session.user.role) }))
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
