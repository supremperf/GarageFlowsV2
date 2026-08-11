export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { UpdateInvoiceSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { withTotals } from '@/lib/billing'
import { lineToScaled, linesToEuros } from '@/lib/money-db'
import { checkStatusTransition, areAmountsLocked, isDeletable, invoiceHoldsStock } from '@/lib/document-status'
import {
  collectPartIds, findForeignPartIds,
  commitInvoiceStock, releaseInvoiceStock, syncInvoiceStock,
  InventoryError, type StockTxClient,
} from '@/lib/stock/invoice-stock'
import { logger } from '@/lib/logger'

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

  // SECURITY (IDOR) — une ligne ne peut référencer qu'une pièce de CE garage.
  const foreignParts = await findForeignPartIds(prisma, session.user.garageId, collectPartIds(parsed.data.lines))
  if (foreignParts.length > 0) {
    return NextResponse.json({ error: 'Pièce inconnue dans le stock de ce garage', code: 'PART_NOT_FOUND' }, { status: 400 })
  }

  // Replace lines + update the invoice atomically so a partial failure can never
  // leave the invoice with zero lines.
  //
  // La SYNCHRONISATION DU STOCK a lieu DANS CETTE MÊME TRANSACTION. Il est donc
  // structurellement impossible d'obtenir « facture validée / stock non
  // décrémenté » ou « stock décrémenté / facture non validée » : un stock
  // insuffisant lève et annule l'intégralité du PATCH.
  let lockConflict = false
  let stockError: InventoryError | null = null
  let stockMovements = 0
  let invoice
  try {
    invoice = await prisma.$transaction(async (tx) => {
      // ANTI-TOCTOU : le verrou d'immutabilité et la transition sont RE-CONTRÔLÉS
      // DANS la transaction sur l'état COURANT (le contrôle hors transaction
      // ci-dessus lit un état potentiellement périmé : deux PATCH concurrents
      // pourraient sinon franchir le verrou avec une lecture « draft » périmée).
      const fresh = await tx.invoice.findFirst({ where: { id: params.id, garageId: session.user.garageId }, select: { status: true } })
      if (fresh) {
        if (financialEdit && areAmountsLocked('invoice', fresh.status)) { lockConflict = true; return null }
        if (body.status !== undefined && checkStatusTransition('invoice', fresh.status, body.status)) { lockConflict = true; return null }
      }
      if (body.lines !== undefined) {
        await tx.invoiceLine.deleteMany({ where: { invoiceId: params.id } })
        await tx.invoiceLine.createMany({
          data: body.lines.map((l: { description: string; quantity: number; unitPrice: number; unitCost?: number; isLabor?: boolean; sortOrder?: number; partId?: string | null }, i: number) => ({
            invoiceId: params.id,
            description: l.description,
            ...lineToScaled(l), // saisie euros -> entiers exacts (dix-milliemes)
            isLabor: l.isLabor ?? false,
            sortOrder: l.sortOrder ?? i,
            partId: l.isLabor ? null : (l.partId ?? null),
          })),
        })
      }
      const updated = await tx.invoice.update({
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

      // ── Stock : on compare l'engagement AVANT et APRÈS ────────────────────
      const stockTx = tx as unknown as StockTxClient
      const heldBefore = invoiceHoldsStock(fresh?.status)
      const heldAfter = invoiceHoldsStock(updated.status)
      const args = { invoiceId: params.id, garageId: session.user.garageId, number: updated.number }

      if (!heldBefore && heldAfter) {
        // VALIDATION : draft → émise. Décrément réel, une seule fois.
        stockMovements = (await commitInvoiceStock(stockTx, args)).movements
      } else if (heldBefore && !heldAfter) {
        // ANNULATION : restitution intégrale.
        stockMovements = (await releaseInvoiceStock(stockTx, args)).movements
      } else if (heldAfter && body.lines !== undefined) {
        // MODIFICATION d'une facture déjà engagée : seul le DELTA est appliqué
        // (2 → 3 ne retire que 1). En pratique le verrou d'immutabilité
        // ci-dessus refuse ce cas ; le rapprochement reste le filet de sécurité.
        stockMovements = (await syncInvoiceStock(stockTx, args)).movements
      }

      return updated
    })
  } catch (e) {
    if (e instanceof InventoryError) { stockError = e } else { throw e }
  }

  if (stockError) {
    return NextResponse.json({ error: stockError.message, code: stockError.code }, { status: stockError.status })
  }
  if (lockConflict || !invoice) {
    return NextResponse.json(
      { error: 'Une facture émise ne peut plus être modifiée. Créez un avoir.' },
      { status: 409 },
    )
  }

  await logAudit({ action: 'update', entityType: 'Invoice', entityId: invoice.id, session, req })
  if (stockMovements > 0) {
    // OBSERVABILITÉ : identifiants + volume uniquement. Aucun secret, aucun
    // montant client, aucun jeton.
    logger.info('[stock] invoice.stock-synced', {
      invoiceId: invoice.id, garageId: session.user.garageId,
      status: invoice.status, inventoryMovements: stockMovements,
    })
  }

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
  // Seul un BROUILLON est supprimable, et un brouillon n'engage jamais de stock :
  // `releaseInvoiceStock` est donc normalement un no-op. On l'appelle malgré tout,
  // DANS la même transaction que la suppression, pour qu'aucune quantité ne
  // puisse rester bloquée si un état incohérent existait déjà en base.
  await prisma.$transaction(async (tx) => {
    await releaseInvoiceStock(tx as unknown as StockTxClient, {
      invoiceId: params.id,
      garageId: session.user.garageId,
      number: existing.number,
      reason: `Facture ${existing.number} supprimée (brouillon)`,
    })
    await tx.invoice.delete({ where: { id: params.id, garageId: session.user.garageId } })
  })
  await logAudit({ action: 'delete', entityType: 'Invoice', entityId: params.id, session, req })
  return NextResponse.json({ success: true })
})
