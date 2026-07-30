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
  const active = await prisma.loanerReservation.count({ where: { vehicleId: params.id, status: { in: ['reserved', 'active'] } } })
  if (active > 0) return NextResponse.json({ error: 'Ce véhicule a des réservations actives' }, { status: 400 })
  await prisma.loanerVehicle.delete({ where: { id: params.id, garageId: session.user.garageId } })
  return NextResponse.json({ success: true })
})
