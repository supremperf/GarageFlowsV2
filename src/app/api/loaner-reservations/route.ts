export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { assertRelations } from '@/lib/tenant'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const vehicleId = searchParams.get('vehicleId')
  const status = searchParams.get('status')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const where: Record<string, unknown> = { garageId: session.user.garageId }
  if (vehicleId) where.vehicleId = vehicleId
  if (status) where.status = status
  if (startDate && endDate) {
    where.OR = [
      { startDate: { gte: new Date(startDate), lte: new Date(endDate) } },
      { endDate: { gte: new Date(startDate), lte: new Date(endDate) } },
    ]
  }

  const reservations = await prisma.loanerReservation.findMany({
    where,
    include: { vehicle: { select: { id: true, name: true, licensePlate: true, color: true } } },
    orderBy: { startDate: 'asc' },
  })

  return NextResponse.json(reservations)
})

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  if (!body.vehicleId) return NextResponse.json({ error: 'vehicleId requis' }, { status: 400 })
  if (!body.clientName?.trim()) return NextResponse.json({ error: 'clientName requis' }, { status: 400 })
  if (!body.startDate || !body.endDate) return NextResponse.json({ error: 'startDate et endDate requis' }, { status: 400 })

  const vehicle = await prisma.loanerVehicle.findFirst({ where: { id: body.vehicleId, garageId: session.user.garageId } })
  if (!vehicle) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })

  // SECURITY (IDOR): une intervention liée doit appartenir au garage.
  const relErr = await assertRelations(session.user.garageId, [{ model: 'job', id: body.jobId, label: 'Intervention' }])
  if (relErr) return relErr

  const reservation = await prisma.loanerReservation.create({
    data: {
      garageId:     session.user.garageId,
      vehicleId:    body.vehicleId,
      jobId:        body.jobId ?? null,
      clientName:   body.clientName.trim(),
      clientPhone:  body.clientPhone ?? null,
      startDate:    new Date(body.startDate),
      endDate:      new Date(body.endDate),
      mileageOut:   body.mileageOut ? Number(body.mileageOut) : null,
      conditionOut: body.conditionOut ?? null,
      notes:        body.notes ?? null,
      isPaid:       Boolean(body.isPaid),
      dailyRate:    body.dailyRate != null ? Number(body.dailyRate) : null,
      depositAmount:body.depositAmount != null ? Number(body.depositAmount) : null,
      status:       'reserved',
    },
    include: { vehicle: { select: { id: true, name: true, licensePlate: true } } },
  })

  return NextResponse.json(reservation, { status: 201 })
})
