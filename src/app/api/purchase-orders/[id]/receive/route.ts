export const dynamic = "force-dynamic"
import { parsePoLinesJson } from '@/lib/money-json'
import { fromScaled } from '@/lib/money'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'

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

  // Run everything atomically
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
      }
    }
    })
  } catch (err) {
    if (err instanceof ReceiveError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }

  return NextResponse.json({ success: true, stockUpdated: lines.filter(l => l.partId && l.qty > 0).length })
})

class ReceiveError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}
