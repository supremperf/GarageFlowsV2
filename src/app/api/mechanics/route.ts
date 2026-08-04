export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { CreateMechanicSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { normalizeSpecialty } from '@/lib/specialty'

// GET /api/mechanics
export const GET = withAuth(async () => {
  const session = await requireSession()

  const mechanics = await prisma.mechanic.findMany({
    where: { garageId: session.user.garageId },
    orderBy: { order: 'asc' },
  })

  return NextResponse.json(mechanics)
})

// POST /api/mechanics
export const POST = withAuth(async (req) => {
  const session = await requireSession()

  // Only OWNER or MANAGER can add mechanics
  if (!['OWNER', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const body = await req.json()

  const parsed = CreateMechanicSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  const { name, avatar, color, specialty = '[]' } = body
  if (!name || !color) {
    return NextResponse.json({ error: 'Nom et couleur requis' }, { status: 400 })
  }

  const count = await prisma.mechanic.count({ where: { garageId: session.user.garageId } })

  const mechanic = await prisma.mechanic.create({
    data: {
      name,
      avatar: avatar || name.substring(0, 2).toUpperCase(),
      color,
      specialty: normalizeSpecialty(specialty),
      order: count + 1,
      garageId: session.user.garageId,
    },
  })

  await logAudit({ action: 'create', entityType: 'Mechanic', entityId: mechanic.id, session, req })

  return NextResponse.json(mechanic, { status: 201 })
})
