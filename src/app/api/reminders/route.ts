export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { assertRelations } from '@/lib/tenant'

// GET /api/reminders?status=pending
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'pending'

  const reminders = await prisma.reminder.findMany({
    where: {
      garageId: session.user.garageId,
      ...(status !== 'all' && { status }),
    },
    orderBy: { scheduledDate: 'asc' },
    include: {
      vehicle: { select: { licensePlate: true, make: true, model: true } },
      client: { select: { name: true, phone: true, email: true } },
    },
  })

  return NextResponse.json(reminders)
})

// POST /api/reminders
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  const { clientName, vehicleModel, licensePlate, phone, email,
          type, scheduledDate, scheduledTime, notes, vehicleId, clientId } = body

  if (!clientName || !type || !scheduledDate) {
    return NextResponse.json({ error: 'clientName, type, scheduledDate requis' }, { status: 400 })
  }

  // SECURITY (IDOR): véhicule & client liés doivent appartenir au garage.
  const relErr = await assertRelations(session.user.garageId, [
    { model: 'vehicle', id: vehicleId, label: 'Véhicule' },
    { model: 'client', id: clientId, label: 'Client' },
  ])
  if (relErr) return relErr

  const reminder = await prisma.reminder.create({
    data: {
      garageId: session.user.garageId,
      clientName,
      vehicleModel: vehicleModel || null,
      licensePlate: licensePlate || null,
      phone: phone || null,
      email: email || null,
      type,
      scheduledDate,
      scheduledTime: scheduledTime || null,
      notes: notes || null,
      vehicleId: vehicleId || null,
      clientId: clientId || null,
    },
  })

  return NextResponse.json(reminder, { status: 201 })
})

// PATCH /api/reminders  body: { id, status }
export const PATCH = withAuth(async (req) => {
  const session = await requireSession()
  const { id, status } = await req.json()

  // Atomique (anti-TOCTOU) : la portée garageId est dans le where.
  const res = await prisma.reminder.updateMany({
    where: { id, garageId: session.user.garageId },
    data: { status },
  })
  if (res.count === 0) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  const updated = await prisma.reminder.findFirst({ where: { id, garageId: session.user.garageId } })
  return NextResponse.json(updated)
})

// DELETE /api/reminders  body: { id }
export const DELETE = withAuth(async (req) => {
  const session = await requireSession()
  const { id } = await req.json()

  // Atomique (anti-TOCTOU) : supprime uniquement si l'objet est dans le garage.
  const res = await prisma.reminder.deleteMany({ where: { id, garageId: session.user.garageId } })
  if (res.count === 0) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  return NextResponse.json({ success: true })
})
