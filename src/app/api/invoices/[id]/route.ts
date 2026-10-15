export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma, isPostgresDatabase } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can, redactLineCosts } from '@/lib/authz'
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
  // Coût d'achat retiré pour les rôles sans `financial:read` (GF31-AUD-009).
  return NextResponse.json(
    withTotals({ ...invoice, lines: redactLineCosts(linesToEuros(invoice.lines), session.user.role) }),
  )
})

export const PATCH = withAuth(async (req, { params }) => {
  const session = await requireSession()
  // §16 — le contrôle d'accès appartient au serveur. La matrice `authz.ts`
  // réserve `invoice:manage` à MANAGER et OWNER (un RECEPTIONIST a
  // `quote:manage`, PAS `invoice:manage`) ; aucune route de facturation ne
  // l'appliquait, si bien que la matrice était purement déclarative sur le
  // document le plus sensible du produit (GF31-AUD-009). Pour ouvrir la
  // facturation à un autre rôle, modifier la MATRICE — pas cette route.
  if (!can(session.user.role, 'invoice:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
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

  // ── IDENTITÉ DE L'ACHETEUR — scellée avec le document (§51) ────────────────
  // Les MONTANTS d'une facture émise étaient figés, mais pas l'identité de
  // celui à qui elle est adressée : le numéro séquentiel restait, l'acheteur
  // changeait, et rien n'en gardait trace. C'est une falsification silencieuse
  // d'un document comptable scellé — or le module se réclame des règles
  // françaises, où une facture émise se corrige par avoir, jamais par
  // réécriture. Le dépôt applique déjà cette doctrine à la SUPPRESSION
  // (« Une facture émise ne peut pas être supprimée. Créez un avoir. »).
  const CHAMPS_IDENTITE = ['clientName', 'clientEmail', 'clientPhone', 'clientAddress', 'vehicleModel', 'licensePlate'] as const
  const identityEdit = CHAMPS_IDENTITE.some((f) => body[f] !== undefined)
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
  let identityConflict = false
  let stockError: InventoryError | null = null
  let stockMovements = 0
  let invoice
  try {
    invoice = await prisma.$transaction(async (tx) => {
      // ANTI-TOCTOU : le verrou d'immutabilité et la transition sont RE-CONTRÔLÉS
      // DANS la transaction sur l'état COURANT (le contrôle hors transaction
      // ci-dessus lit un état potentiellement périmé : deux PATCH concurrents
      // pourraient sinon franchir le verrou avec une lecture « draft » périmée).
      // Verrou de LIGNE avant la relecture : sans lui, la relecture reste un
      // simple `findFirst`, donc non bloquante. Sous PostgreSQL en READ
      // COMMITTED, deux requêtes concurrentes lisent alors toutes deux l'état
      // « draft » et franchissent le verrou d'immutabilité : la première valide
      // le document, la seconde réécrit ses lignes par-dessus un document déjà
      // émis (GF31-AUD-010). Même dispositif que PATCH /api/admin/licenses/[id].
      if (isPostgresDatabase()) {
        await tx.$executeRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${params.id} FOR UPDATE`
      }
      const fresh = await tx.invoice.findFirst({ where: { id: params.id, garageId: session.user.garageId }, select: { status: true } })
      if (fresh) {
        if (financialEdit && areAmountsLocked('invoice', fresh.status)) { lockConflict = true; return null }
        // Même verrou que les montants, au même moment : DANS la transaction,
        // sur l'état courant (anti-TOCTOU).
        if (identityEdit && areAmountsLocked('invoice', fresh.status)) { identityConflict = true; return null }
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
  if (identityConflict) {
    return NextResponse.json(
      {
        error: "L'identité du client d'une facture émise ne peut plus être modifiée. "
             + 'Annulez cette facture et émettez-en une nouvelle.',
        code: 'INVOICE_IDENTITY_LOCKED',
      },
      { status: 409 },
    )
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

  return NextResponse.json(withTotals({ ...invoice, lines: redactLineCosts(linesToEuros(invoice.lines), session.user.role) }))
})

/** La facture est passée à « émise » pendant la suppression : 409, pas 500. */
class FactureEmiseEntreTemps extends Error {}

export const DELETE = withAuth(async (req, { params }) => {
  const session = await requireSession()
  // Supprimer une facture est un acte de gestion : même exigence que POST/PATCH
  // (matrice `authz.ts`, GF31-AUD-009).
  if (!can(session.user.role, 'invoice:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
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
  try {
    await prisma.$transaction(async (tx) => {
      await releaseInvoiceStock(tx as unknown as StockTxClient, {
        invoiceId: params.id,
        garageId: session.user.garageId,
        number: existing.number,
        reason: `Facture ${existing.number} supprimée (brouillon)`,
      })

      // Le devis d'où venait cette facture retrouve son état d'avant conversion.
      //
      // `Quote.invoice` est en `onDelete: SetNull` : supprimer la facture laissait
      // le devis au statut TERMINAL « converted » avec un `invoiceId` à nul. Il
      // n'était alors plus convertible (« Devis déjà converti »), plus
      // supprimable (un devis converti se conserve), et ne pointait plus sur rien :
      // le garage devait tout ressaisir, en gardant un document mort en base
      // (GF31-AUD-047).
      await tx.quote.updateMany({
        where: { garageId: session.user.garageId, invoiceId: params.id, status: 'converted' },
        data: { status: 'accepted', invoiceId: null },
      })

      // ── Le statut est REVÉRIFIÉ ici, dans la transaction ───────────────────
      // Le contrôle `isDeletable` ci-dessus lit la facture AVANT d'ouvrir la
      // transaction. Entre cette lecture et cette ligne, un autre onglet — ou la
      // seconde moitié d'un double-clic — pouvait émettre la facture : la
      // suppression partait quand même et effaçait physiquement une facture
      // ÉMISE, avec son numéro de la série séquentielle. Rien ne la reconstitue,
      // et le contrôle FEC voit un trou dans la numérotation.
      //
      // `deleteMany` avec `status: 'draft'` rend le contrôle et l'effacement
      // atomiques : si le statut a bougé, `count` vaut 0 et toute la transaction
      // est annulée, y compris la restitution de stock déjà écrite au-dessus.
      const supprimee = await tx.invoice.deleteMany({
        where: { id: params.id, garageId: session.user.garageId, status: 'draft' },
      })
      if (supprimee.count === 0) throw new FactureEmiseEntreTemps()
    })
  } catch (e) {
    if (e instanceof FactureEmiseEntreTemps) {
      return NextResponse.json(
        { error: 'La facture a été émise entre-temps. Créez un avoir.' },
        { status: 409 },
      )
    }
    throw e
  }
  await logAudit({ action: 'delete', entityType: 'Invoice', entityId: params.id, session, req })
  return NextResponse.json({ success: true })
})
