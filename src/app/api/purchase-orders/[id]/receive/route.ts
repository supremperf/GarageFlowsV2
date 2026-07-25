export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

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

  const order = await prisma.purchaseOrder.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (order.status === 'received') {
    return NextResponse.json({ error: 'Commande déjà réceptionnée' }, { status: 409 })
  }
  if (order.status === 'cancelled') {
    return NextResponse.json({ error: 'Commande annulée' }, { status: 400 })
  }

  let lines: POLine[] = []
  try { lines = JSON.parse(order.linesJson) } catch { lines = [] }

  // Run everything atomically
  await prisma.$transaction(async (tx) => {
    // Mark PO received
    await tx.purchaseOrder.update({
      where: { id: params.id },
      data: { status: 'received', receivedAt: new Date() },
    })

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
          where: { id: line.partId },
          data: { quantity: { increment: line.qty } },
        })
      }
    }
  })

  return NextResponse.json({ success: true, stockUpdated: lines.filter(l => l.partId && l.qty > 0).length })
})
