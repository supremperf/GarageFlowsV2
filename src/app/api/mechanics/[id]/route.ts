export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { normalizeSpecialty } from '@/lib/specialty'

// PATCH /api/mechanics/:id  (toggle absence, update info)
export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()

  const existing = await prisma.mechanic.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const body = await req.json()
  const allowed = ['name', 'color', 'isAbsent', 'specialty', 'order']
  const data: Record<string, unknown> = {}
  for (const f of allowed) {
    if (f in body) {
      data[f] = f === 'specialty' ? normalizeSpecialty(body[f]) : body[f]
    }
  }

  const updated = await prisma.mechanic.update({ where: { id: params.id, garageId: session.user.garageId }, data })

  await logAudit({ action: 'update', entityType: 'Mechanic', entityId: updated.id, session, req })

  return NextResponse.json(updated)
})

// DELETE /api/mechanics/:id
export const DELETE = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()

  if (!['OWNER', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const existing = await prisma.mechanic.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  // Unassign any future jobs first
  await prisma.job.updateMany({
    where: {
      mechanicId: params.id,
      garageId: session.user.garageId,
      status: { in: ['scheduled'] },
    },
    data: { status: 'cancelled' },
  })

  await prisma.mechanic.delete({ where: { id: params.id, garageId: session.user.garageId } })

  await logAudit({ action: 'delete', entityType: 'Mechanic', entityId: params.id, session, req })

  return NextResponse.json({ success: true })
})
