export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.loanerVehicle.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json()
  const data: Record<string, unknown> = {}
  if (body.name !== undefined)         data.name         = body.name
  if (body.licensePlate !== undefined) data.licensePlate = body.licensePlate
  if (body.make !== undefined)         data.make         = body.make
  if (body.model !== undefined)        data.model        = body.model
  if (body.year !== undefined)         data.year         = body.year ? Number(body.year) : null
  if (body.color !== undefined)        data.color        = body.color
  if (body.notes !== undefined)        data.notes        = body.notes
  if (body.isActive !== undefined)     data.isActive     = Boolean(body.isActive)
  // garageId in WHERE prevents cross-tenant writes (atomic, anti-TOCTOU)
  const updated = await prisma.loanerVehicle.update({ where: { id: params.id, garageId: session.user.garageId }, data })
  return NextResponse.json(updated)
})

export const DELETE = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.loanerVehicle.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // `LoanerReservation.vehicle` est en `onDelete: Cascade` : supprimer le
  // véhicule effaçait TOUT son historique de prêt — kilométrages, états des
  // lieux contradictoires, cautions — c'est-à-dire les pièces qui tranchent un
  // litige client. Le seul garde-fou comptait les réservations `reserved` ou
  // `active` : il ne protégeait pas l'historique, et il suffisait de sortir une
  // réservation vive de cette liste pour le franchir.
  //
  // On refuse donc dès qu'il existe UNE réservation, quel que soit son statut,
  // et on oriente vers la désactivation — qui existe déjà (`isActive`, filtrée
  // par `GET /api/loaner-vehicles?activeOnly=true`) et conserve l'historique.
  const [vives, total] = await Promise.all([
    prisma.loanerReservation.count({ where: { vehicleId: params.id, status: { in: ['reserved', 'active'] } } }),
    prisma.loanerReservation.count({ where: { vehicleId: params.id } }),
  ])
  if (vives > 0) {
    return NextResponse.json(
      { error: 'Ce véhicule a des réservations actives', code: 'VEHICLE_HAS_ACTIVE_RESERVATIONS' },
      { status: 400 },
    )
  }
  if (total > 0) {
    return NextResponse.json(
      {
        error: `Ce véhicule a ${total} prêt(s) dans son historique : le supprimer effacerait ces preuves (kilométrages, états des lieux, cautions). Désactivez-le pour le retirer des listes tout en conservant l'historique.`,
        code: 'VEHICLE_HAS_HISTORY',
      },
      { status: 409 },
    )
  }

  await prisma.loanerVehicle.delete({ where: { id: params.id, garageId: session.user.garageId } })
  return NextResponse.json({ success: true })
})
