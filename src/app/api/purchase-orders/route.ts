export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

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

  // Auto-generate number
  const garage = await prisma.garage.update({
    where: { id: session.user.garageId },
    data: { purchaseOrderCounter: { increment: 1 } },
  })
  const year = new Date().getFullYear()
  const number = `${garage.purchaseOrderPrefix}-${year}-${String(garage.purchaseOrderCounter).padStart(3, '0')}`

  const linesJson = typeof body.linesJson === 'string' ? body.linesJson : JSON.stringify(body.linesJson ?? [])
  const lines: Array<{ unitCost: number; qty: number }> = JSON.parse(linesJson)
  const totalHT = Math.round(lines.reduce((s, l) => s + (l.unitCost ?? 0) * (l.qty ?? 1), 0) * 100) / 100

  const order = await prisma.purchaseOrder.create({
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

  return NextResponse.json(order, { status: 201 })
})
