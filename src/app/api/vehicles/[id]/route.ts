export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { UpdateVehicleSchema } from '@/lib/schemas'
import { assertRelations } from '@/lib/tenant'
import { logAudit } from '@/lib/audit'

// GET /api/vehicles/:id  — full vehicle fiche with history
export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: {
      client: true,
      jobs: {
        where: { status: { not: 'cancelled' } },
        orderBy: { date: 'desc' },
        include: {
          mechanic: { select: { id: true, name: true, color: true, avatar: true } },
          jobParts: { include: { part: { select: { id: true, name: true, reference: true } } } },
        },
      },
    },
  })

  if (!vehicle) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  return NextResponse.json(vehicle)
})

// PATCH /api/vehicles/:id
export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.vehicle.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const body = await req.json()

  const parsed = UpdateVehicleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  const allowed = ['vin', 'make', 'model', 'year', 'mileage', 'color', 'notes', 'clientId', 'ctDate']
  const data: Record<string, unknown> = {}
  for (const f of allowed) { if (f in parsed.data) data[f] = (parsed.data as Record<string, unknown>)[f] }

  // Isolation multi-tenant : un clientId fourni doit appartenir au garage de la
  // session (sinon IDOR de 2nd ordre — le GET renvoie la PII du client via
  // include:{client}). Le POST validait déjà ; le PATCH l'omettait.
  const relCheck = await assertRelations(session.user.garageId, [
    { model: 'client', id: data.clientId as string | null | undefined, label: 'Client' },
  ])
  if (relCheck) return relCheck

  const updated = await prisma.vehicle.update({ where: { id: params.id, garageId: session.user.garageId }, data })

  await logAudit({ action: 'update', entityType: 'Vehicle', entityId: params.id, session, req })

  return NextResponse.json(updated)
})
