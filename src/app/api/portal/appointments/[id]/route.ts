export const dynamic = 'force-dynamic'

/**
 * Portal appointment update (Phase 2).
 *   PATCH  — modify a slot (reason/date/startTime/durationMin/notes), re-validated.
 *   DELETE — cancel the appointment.
 * Only appointments in a modifiable state (requested/confirmed) can be changed.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withPortalAuth } from '@/lib/portal/auth-helpers'
import { validateSlot, canModifyAppointment, nextAppointmentStatus, type AppointmentStatus } from '@/lib/portal/appointments'

type RouteCtx = { params: { id: string } }

export const PATCH = withPortalAuth<RouteCtx>(async (req, { user }, { params }) => {
  const existing = await prisma.appointment.findFirst({ where: { id: params.id, portalUserId: user.id } })
  if (!existing) return NextResponse.json({ error: 'Rendez-vous introuvable' }, { status: 404 })
  if (!canModifyAppointment(existing.status as AppointmentStatus)) {
    return NextResponse.json({ error: 'Ce rendez-vous ne peut plus être modifié' }, { status: 409 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const date = typeof body.date === 'string' ? body.date : existing.date
  const startTime = typeof body.startTime === 'string' ? body.startTime : existing.startTime
  const durationMin = body.durationMin != null ? Number(body.durationMin) : existing.durationMin

  const garage = await prisma.garage.findUnique({ where: { id: user.garageId }, select: { workshopStartHour: true, workshopEndHour: true } })
  const validation = validateSlot({ date, startTime, durationMin, workshopStartHour: garage?.workshopStartHour ?? 8, workshopEndHour: garage?.workshopEndHour ?? 18 })
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 })

  const appointment = await prisma.appointment.update({
    where: { id: existing.id },
    data: {
      date, startTime, durationMin,
      reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : existing.reason,
      notes: typeof body.notes === 'string' ? body.notes : existing.notes,
      // A modified confirmed slot returns to "requested" so the garage re-confirms.
      status: 'requested',
    },
  })
  return NextResponse.json({ ok: true, appointment })
})

export const DELETE = withPortalAuth<RouteCtx>(async (_req, { user }, { params }) => {
  const existing = await prisma.appointment.findFirst({ where: { id: params.id, portalUserId: user.id } })
  if (!existing) return NextResponse.json({ error: 'Rendez-vous introuvable' }, { status: 404 })

  const status = nextAppointmentStatus(existing.status as AppointmentStatus, 'cancel')
  if (!status) return NextResponse.json({ error: 'Ce rendez-vous ne peut pas être annulé' }, { status: 409 })

  await prisma.appointment.update({ where: { id: existing.id }, data: { status } })
  return NextResponse.json({ ok: true, status })
})
