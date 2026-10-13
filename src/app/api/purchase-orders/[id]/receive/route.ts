export const dynamic = "force-dynamic"
import { parsePoLinesJson } from '@/lib/money-json'
import { fromScaled } from '@/lib/money'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { MOVEMENT } from '@/lib/stock/invoice-stock'

interface POLine {
  partId?: string | null
  partName: string
  reference?: string | null
  qty: number
  unitCost: number
}

// POST /api/purchase-orders/[id]/receive
// Marks the PO as received and increments Part.quantity for each line that has a partId.
// Idempotent: no-op if already received.
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

  // Parsing STRICT versionné (v1 historique OU v2) — plus de JSON.parse nu.
  let lines: Array<{ partId?: string | null; qty: number }> = []
  const fractionnaires: string[] = []
  try {
    lines = parsePoLinesJson(order.linesJson).lines.map((l) => {
      // Le stock se compte en unités ENTIÈRES. Une quantité fractionnaire était
      // silencieusement arrondie à l'entier le plus proche (2,4 → 2) sur un
      // statut TERMINAL et non rejouable : l'écart entre ce que le fournisseur
      // a facturé et ce que le stock enregistre devenait permanent, dans un
      // sens comme dans l'autre, sans le moindre message (GF31-AUD-051).
      const exact = fromScaled(l.qtyTenThousandths)
      if (!Number.isInteger(exact)) fractionnaires.push(`${l.partName ?? l.partId ?? '?'} (${exact})`)
      return { partId: l.partId, qty: Math.round(exact) }
    })
  } catch { lines = [] }

  // Refus AVANT la revendication du statut : la commande reste réceptionnable
  // une fois corrigée, au lieu d'être figée sur un écart de stock invisible.
  if (fractionnaires.length > 0) {
    return NextResponse.json(
      {
        error: `Le stock se compte en unités entières. Quantité fractionnaire sur : ${fractionnaires.join(', ')}. `
             + 'Corrigez la commande avant de la réceptionner.',
        code: 'INVALID_STOCK_QUANTITY',
      },
      { status: 409 },
    )
  }

  // Run everything atomically — avec RELANCE bornée sur contention SQLite.
  // Sur le poste (SQLite), deux réceptions simultanées du même bon (double-clic,
  // double fenêtre) se sérialisent sur le verrou d'écriture du fichier : la
  // transaction perdante expirait en P1008 (« database failed to respond ») et
  // remontait en 500, alors que la revendication atomique ci-dessous aurait
  // répondu proprement 409 une fois la gagnante committée. On relance donc
  // quelques fois sur les seuls codes de contention ; toute autre erreur —
  // et ReceiveError, qui est un verdict métier — repart immédiatement.
  const contention = (err: unknown): boolean =>
    typeof err === 'object' && err !== null && 'code' in err &&
    ['P1008', 'P2028', 'P2034'].includes(String((err as { code: unknown }).code))

  for (let tentative = 1; ; tentative++) {
   try {
    await prisma.$transaction(async (tx) => {
    // Claim the PO atomically: only proceed if it is NOT already received/cancelled.
    // Prevents a double-reception race (double stock increment) and cross-tenant writes.
    // `returned` manquait à cette liste. Or un retour DÉCRÉMENTE le stock : une
    // commande retournée puis « réceptionnée » à nouveau le ré-incrémentait,
    // c'est-à-dire exactement le double comptage que cette revendication
    // atomique existe pour empêcher. Le cycle est
    // draft → sent → confirmed → received → returned : `returned` est terminal
    // au même titre que `received` et `cancelled`.
    const claim = await tx.purchaseOrder.updateMany({
      where: {
        id: params.id,
        garageId: session.user.garageId,
        status: { notIn: ['received', 'cancelled', 'returned'] },
      },
      data: { status: 'received', receivedAt: new Date() },
    })
    if (claim.count === 0) throw new ReceiveError(409, 'Commande déjà réceptionnée, retournée ou annulée')

    // Increment stock for each line with a known partId
    const stockUpdates = lines.filter(
      (l): l is POLine & { partId: string } => !!l.partId && l.qty > 0
    )
    for (const line of stockUpdates) {
      // Verify part belongs to same garage before updating
      const part = await tx.part.findFirst({
        where: { id: line.partId, garageId: session.user.garageId },
        select: { id: true },
      })
      if (part) {
        await tx.part.update({
          where: { id: line.partId, garageId: session.user.garageId },
          data: { quantity: { increment: line.qty } },
        })
        // ── L'entrée en stock est journalisée elle aussi (GF-037) ────────────
        // Le schéma pose que le stock d'une pièce est reconstituable à partir
        // de `StockMovement`. La réception fournisseur — la principale ENTRÉE
        // de stock d'un garage — n'y écrivait rien : le journal ne montrait que
        // des sorties, et un inventaire qui ne tombe pas juste n'avait aucune
        // trace d'entrée à confronter.
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
    }
    })
    break
   } catch (err) {
    if (err instanceof ReceiveError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (contention(err) && tentative < 5) {
      await new Promise((r) => setTimeout(r, 100 * tentative))
      continue
    }
    throw err
   }
  }

  return NextResponse.json({ success: true, stockUpdated: lines.filter(l => l.partId && l.qty > 0).length })
})

class ReceiveError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}
