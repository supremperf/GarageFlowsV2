export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { coercePartField } from '@/lib/schemas'

// PATCH /api/parts/:id
export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.part.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const body = await req.json()
  const allowed = ['name', 'reference', 'description', 'quantity', 'minQuantity', 'unitCost', 'unitPrice', 'location'] as const
  // SÉCURITÉ : coercition stricte par champ. Sans elle, `data[f] = body[f]`
  // laissait passer un objet d'opérateur Prisma ({increment}/{multiply}) ou un
  // type invalide (NaN persisté). coercePartField normalise et LÈVE si invalide.
  const data: Record<string, unknown> = {}
  for (const f of allowed) {
    if (!(f in body)) continue
    const v = coercePartField(f, body[f])
    if (v instanceof Error) return NextResponse.json({ error: v.message }, { status: 400 })
    data[f] = v
  }

  const updated = await prisma.part.update({ where: { id: params.id, garageId: session.user.garageId }, data })
  return NextResponse.json(updated)
})

// DELETE /api/parts/:id
export const DELETE = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  await prisma.part.delete({ where: { id: params.id, garageId: session.user.garageId } })
  return NextResponse.json({ success: true })
})
