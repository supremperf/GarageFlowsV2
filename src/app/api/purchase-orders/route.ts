export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { multiplyCents, toCents, fromCents } from '@/lib/money'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const where: Record<string, unknown> = { garageId: session.user.garageId }
  if (status) where.status = status
  const orders = await prisma.purchaseOrder.findMany({ where, orderBy: { createdAt: 'desc' } })
  return NextResponse.json(orders)
})

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  const year = new Date().getFullYear()

  // Parse défensif des lignes + total HT EXACT en centimes (par ligne, sans dérive).
  const linesJson = typeof body.linesJson === 'string' ? body.linesJson : JSON.stringify(body.linesJson ?? [])
  let lines: Array<{ unitCost: number; qty: number }>
  try {
    const parsed = JSON.parse(linesJson)
    lines = Array.isArray(parsed) ? parsed : []
  } catch {
    return NextResponse.json({ error: 'Lignes de commande invalides' }, { status: 400 })
  }
  const totalHT = fromCents(
    lines.reduce((c, l) => c + multiplyCents(toCents(Number(l.unitCost) || 0), Number(l.qty) || 0), 0),
  )

  // Réservation du numéro + création atomiques ; unicité par @@unique([garageId, number]).
  let order
  try {
    order = await prisma.$transaction(async (tx) => {
      const garage = await tx.garage.update({
        where: { id: session.user.garageId },
        data: { purchaseOrderCounter: { increment: 1 } },
      })
      const number = `${garage.purchaseOrderPrefix}-${year}-${String(garage.purchaseOrderCounter).padStart(3, '0')}`
      return tx.purchaseOrder.create({
        data: {
          number,
          garageId:      session.user.garageId,
          supplierName:  body.supplierName ?? null,
          supplierEmail: body.supplierEmail ?? null,
          linesJson,
          totalHT,
          status:        'draft',
          notes:         body.notes ?? null,
        },
      })
    })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'Numéro de bon de commande déjà utilisé, réessayez' }, { status: 409 })
    }
    throw e
  }

  return NextResponse.json(order, { status: 201 })
})
