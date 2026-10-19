export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { purchaseOrderToEuros } from '@/lib/money-db'
import { parsePoLinesJson, serializePoLinesJsonV2, poTotalHtCents, poLinesToEuros } from '@/lib/money-json'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const where: Record<string, unknown> = { garageId: session.user.garageId }
  if (status) where.status = status
  const orders = await prisma.purchaseOrder.findMany({ where, orderBy: { createdAt: 'desc' } })
  return NextResponse.json(orders.map(o => { try { return { ...purchaseOrderToEuros(o), lines: poLinesToEuros(parsePoLinesJson(o.linesJson).lines) } } catch { return { ...purchaseOrderToEuros(o), lines: [], jsonError: true } } }))
})

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  if (!can(session.user.role, 'stock:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const body = await req.json()

  const year = new Date().getFullYear()

  // Validation STRICTE (v1 euros OU v2 entiers) + conversion exacte + V2 persisté.
  const linesRaw = typeof body.linesJson === 'string' ? body.linesJson : JSON.stringify(body.linesJson ?? [])
  let exactLines
  try {
    exactLines = parsePoLinesJson(linesRaw).lines
  } catch {
    return NextResponse.json({ error: 'Lignes de commande invalides' }, { status: 400 })
  }
  const linesJson = serializePoLinesJsonV2(exactLines)
  const totalHtCents = poTotalHtCents(exactLines)

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
          totalHtCents,
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

  return NextResponse.json(purchaseOrderToEuros(order), { status: 201 })
})
