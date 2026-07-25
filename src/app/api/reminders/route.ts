export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'

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

  const existing = await prisma.reminder.findFirst({
    where: { id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const updated = await prisma.reminder.update({
    where: { id },
    data: { status },
  })
  return NextResponse.json(updated)
})

// DELETE /api/reminders  body: { id }
export const DELETE = withAuth(async (req) => {
  const session = await requireSession()
  const { id } = await req.json()

  const existing = await prisma.reminder.findFirst({
    where: { id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  await prisma.reminder.delete({ where: { id } })
  return NextResponse.json({ success: true })
})
