export const dynamic = 'force-dynamic'

/**
 * Portal appointments (Phase 2).
 *   GET  — list the client's appointments.
 *   POST — request a slot. Body: { reason, date, startTime, durationMin?, vehicleId?,
 *          vehicleModel?, licensePlate?, notes? }. Validated against workshop hours.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withPortalAuth } from '@/lib/portal/auth-helpers'
import { validateSlot } from '@/lib/portal/appointments'

export const GET = withPortalAuth(async (_req, { user }) => {
  const [appointments, garage] = await Promise.all([
    prisma.appointment.findMany({
      where: { portalUserId: user.id },
      orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
      take: 100,
    }),
    prisma.garage.findUnique({
      where: { id: user.garageId },
      select: { workshopStartHour: true, workshopEndHour: true },
    }),
  ])
  // Les HORAIRES accompagnent la liste : `validateSlot` refuse tout créneau hors
  // ouverture, et sans les connaître le client ne peut que deviner puis se voir
  // refuser. Ce ne sont pas des données sensibles — un garage affiche ses heures
  // sur sa devanture.
  return NextResponse.json({
    appointments,
    horaires: {
      ouverture: garage?.workshopStartHour ?? 8,
      fermeture: garage?.workshopEndHour ?? 18,
    },
  })
})

export const POST = withPortalAuth(async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const reason = String(body.reason ?? '').trim()
  const date = String(body.date ?? '').trim()
  const startTime = String(body.startTime ?? '').trim()
  const durationMin = Number(body.durationMin ?? 60)
  if (!reason) return NextResponse.json({ error: 'Motif requis' }, { status: 400 })

  const garage = await prisma.garage.findUnique({
    where: { id: user.garageId },
    select: { workshopStartHour: true, workshopEndHour: true },
  })
  const validation = validateSlot({
    date, startTime, durationMin,
    workshopStartHour: garage?.workshopStartHour ?? 8,
    workshopEndHour: garage?.workshopEndHour ?? 18,
  })
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 })

  // Isolation : un vehicleId fourni doit être un véhicule DE CE client (même
  // garage). Sinon on refuse le rattachement.
  let vehicleId: string | null = null
  if (typeof body.vehicleId === 'string' && body.vehicleId && user.clientId) {
    const owned = await prisma.vehicle.findFirst({
      where: { id: body.vehicleId, garageId: user.garageId, clientId: user.clientId },
      select: { id: true },
    })
    if (!owned) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 400 })
    vehicleId = owned.id
  }

  const appointment = await prisma.appointment.create({
    data: {
      garageId: user.garageId,
      portalUserId: user.id,
      clientId: user.clientId,
      vehicleId,
      clientName: user.name ?? user.email,
      vehicleModel: typeof body.vehicleModel === 'string' ? body.vehicleModel : null,
      licensePlate: typeof body.licensePlate === 'string' ? body.licensePlate : null,
      reason,
      date,
      startTime,
      durationMin,
      status: 'requested',
      notes: typeof body.notes === 'string' ? body.notes : null,
    },
  })
  return NextResponse.json({ ok: true, appointment }, { status: 201 })
})
