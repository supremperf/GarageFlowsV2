export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { toScaled } from '@/lib/money'
import { partToEuros } from '@/lib/money-db'

// PATCH /api/parts/:id
export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.part.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const body = await req.json()
  const allowed = ['name', 'reference', 'description', 'quantity', 'minQuantity', 'location']
  const data: Record<string, unknown> = {}
  for (const f of allowed) { if (f in body) data[f] = body[f] }
  // Saisie en euros → entiers exacts (dix-millièmes) : unique source de vérité.
  if ('unitCost' in body) data.unitCostTenThousandths = toScaled(Number(body.unitCost))
  if ('unitPrice' in body) data.unitPriceTenThousandths = toScaled(Number(body.unitPrice))

  const updated = await prisma.part.update({ where: { id: params.id, garageId: session.user.garageId }, data })
  return NextResponse.json(partToEuros(updated))
})

// DELETE /api/parts/:id
export const DELETE = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  await prisma.part.delete({ where: { id: params.id, garageId: session.user.garageId } })
  return NextResponse.json({ success: true })
})
