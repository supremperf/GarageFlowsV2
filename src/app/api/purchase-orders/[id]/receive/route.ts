export const dynamic = "force-dynamic"
import { parsePoLinesJson } from '@/lib/money-json'
import { fromScaled } from '@/lib/money'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { MOVEMENT } from '@/lib/stock/invoice-stock'

// POST /api/purchase-orders/[id]/receive
// Marks the PO as received and increments Part.quantity for each line that has a partId.
// Conflicting repeat requests receive 409 and never increment stock twice.
export const POST = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  if (!can(session.user.role, 'stock:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const order = await prisma.purchaseOrder.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (order.status === 'received') {
    return NextResponse.json({ error: 'Commande déjà réceptionnée' }, { status: 409 })
  }
  if (order.status === 'returned') {
    return NextResponse.json({ error: 'Commande retournée : elle ne peut plus être réceptionnée.' }, { status: 409 })
  }
  if (order.status === 'cancelled') {
    return NextResponse.json({ error: 'Commande annulée' }, { status: 400 })
  }

  // Parsing STRICT versionné (v1 historique OU v2) — une ligne malformée ou
  // vide ne doit jamais devenir une réception prétendument réussie.
  let exactLines: ReturnType<typeof parsePoLinesJson>['lines']
  try {
    exactLines = parsePoLinesJson(order.linesJson).lines
  } catch {
    return NextResponse.json({
      error: 'Lignes du bon de commande invalides ; corrigez-les avant réception.',
      code: 'INVALID_PURCHASE_ORDER_LINES',
    }, { status: 409 })
  }
  if (!exactLines.length || exactLines.some((line) =>
    !line.partName.trim() || fromScaled(line.qtyTenThousandths) <= 0
  )) {
    return NextResponse.json({
      error: 'Le bon ne contient aucune ligne réceptionnable ; corrigez-le avant réception.',
      code: 'INVALID_PURCHASE_ORDER_LINES',
    }, { status: 409 })
  }

  // Le stock se compte en unités ENTIÈRES. Une quantité fractionnaire ne doit
  // jamais être arrondie avant de rendre le statut terminal.
  const fractionnaires = exactLines
    .map((line) => ({ name: line.partName || line.partId || '?', qty: fromScaled(line.qtyTenThousandths) }))
    .filter((line) => !Number.isInteger(line.qty))
  if (fractionnaires.length > 0) {
    return NextResponse.json(
      {
        error: `Le stock se compte en unités entières. Quantité fractionnaire sur : ${fractionnaires.map((line) => `${line.name} (${line.qty})`).join(', ')}. Corrigez le bon avant réception.`,
        code: 'INVALID_STOCK_QUANTITY',
      },
      { status: 409 },
    )
  }

  const lines = exactLines.map((line) => ({ partId: line.partId, qty: fromScaled(line.qtyTenThousandths) }))
  const stockUpdates: Array<{ partId: string; qty: number }> = lines.filter(
    (line): line is { partId: string; qty: number } => !!line.partId && line.qty > 0,
  )
  const stockPartIds = [...new Set(stockUpdates.map((line) => line.partId))]

  // Run everything atomically — avec RELANCE bornée sur contention SQLite.
  // Un bon lié à une pièce supprimée/étrangère reste réceptionnable uniquement
  // après correction ; il ne devient jamais terminal avec un stock inchangé.
  const contention = (err: unknown): boolean =>
    typeof err === 'object' && err !== null && 'code' in err &&
    ['P1008', 'P2028', 'P2034'].includes(String((err as { code: unknown }).code))
  const integrityRace = (err: unknown): boolean =>
    typeof err === 'object' && err !== null && 'code' in err &&
    ['P2003', 'P2025'].includes(String((err as { code: unknown }).code))

  let stockUpdated = 0
  for (let tentative = 1; ; tentative++) {
    try {
      stockUpdated = await prisma.$transaction(async (tx) => {
        if (stockPartIds.length) {
          const ownedParts = await tx.part.findMany({
            where: { id: { in: stockPartIds }, garageId: session.user.garageId },
            select: { id: true },
          })
          if (ownedParts.length !== stockPartIds.length) {
            throw new ReceiveError(409, 'Une pièce liée au bon est introuvable dans ce garage. Corrigez les lignes avant réception.')
          }
        }

        // Claim the PO atomically: only proceed if it is NOT already received,
        // cancelled, or returned. This prevents a double stock increment.
        const claim = await tx.purchaseOrder.updateMany({
          where: {
            id: params.id,
            garageId: session.user.garageId,
            status: { notIn: ['received', 'cancelled', 'returned'] },
          },
          data: { status: 'received', receivedAt: new Date() },
        })
        if (claim.count === 0) throw new ReceiveError(409, 'Commande déjà réceptionnée, retournée ou annulée')

        for (const line of stockUpdates) {
          const updated = await tx.part.updateMany({
            where: { id: line.partId, garageId: session.user.garageId },
            data: { quantity: { increment: line.qty } },
          })
          if (updated.count !== 1) {
            throw new ReceiveError(409, 'Une pièce liée au bon n’est plus disponible. Corrigez les lignes avant réception.')
          }
          await tx.stockMovement.create({
            data: {
              garageId: session.user.garageId,
              partId: line.partId,
              type: MOVEMENT.ADJUST,
              quantityDelta: line.qty,
              reason: `Réception du bon de commande ${order.number}`,
            },
          })
        }
        return stockUpdates.length
      })
      break
    } catch (err) {
      if (err instanceof ReceiveError) {
        return NextResponse.json({ error: err.message, code: 'PURCHASE_ORDER_RECEIVE_BLOCKED' }, { status: err.status })
      }
      if (integrityRace(err)) {
        return NextResponse.json({
          error: 'Une pièce liée au bon a changé pendant la réception. Aucune réception n’a été appliquée ; vérifiez puis réessayez.',
          code: 'PURCHASE_ORDER_RECEIVE_BLOCKED',
        }, { status: 409 })
      }
      if (contention(err) && tentative < 5) {
        await new Promise((r) => setTimeout(r, 100 * tentative))
        continue
      }
      throw err
    }
  }

  return NextResponse.json({ success: true, stockUpdated })
})

class ReceiveError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}
