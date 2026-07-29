export const dynamic = 'force-dynamic'

/**
 * POST /api/appointments/[id] — staff action on an appointment (garage-scoped).
 * Body: { action: 'confirm' | 'cancel' | 'complete' }
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { nextAppointmentStatus, type AppointmentStatus, type AppointmentAction } from '@/lib/portal/appointments'

const ACTIONS: readonly AppointmentAction[] = ['confirm', 'cancel', 'complete']

export const POST = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = body.action as AppointmentAction
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: `action invalide (${ACTIONS.join(', ')})` }, { status: 400 })
  }

  const appointment = await prisma.appointment.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!appointment) return NextResponse.json({ error: 'Rendez-vous introuvable' }, { status: 404 })

  const status = nextAppointmentStatus(appointment.status as AppointmentStatus, action)
  if (!status) return NextResponse.json({ error: `Transition « ${action} » impossible depuis « ${appointment.status} »` }, { status: 409 })

  await prisma.appointment.update({ where: { id: appointment.id }, data: { status } })
  return NextResponse.json({ ok: true, status })
})
