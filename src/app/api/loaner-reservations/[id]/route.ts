export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.loanerReservation.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json()
  const data: Record<string, unknown> = {}
  if (body.status !== undefined)      data.status      = body.status
  if (body.clientName !== undefined)  data.clientName  = body.clientName
  if (body.clientPhone !== undefined) data.clientPhone = body.clientPhone
  if (body.startDate !== undefined)   data.startDate   = new Date(body.startDate)
  if (body.endDate !== undefined)     data.endDate     = new Date(body.endDate)
  if (body.mileageOut !== undefined)  data.mileageOut  = body.mileageOut ? Number(body.mileageOut) : null
  if (body.mileageIn !== undefined)   data.mileageIn   = body.mileageIn  ? Number(body.mileageIn)  : null
  if (body.conditionOut !== undefined) data.conditionOut = body.conditionOut
  if (body.conditionIn !== undefined)  data.conditionIn  = body.conditionIn
  if (body.notes !== undefined)        data.notes        = body.notes
  if (body.status === 'returned' && !existing.returnedAt) data.returnedAt = new Date()
  const updated = await prisma.loanerReservation.update({
    where: { id: params.id, garageId: session.user.garageId },
    data,
    include: { vehicle: { select: { id: true, name: true, licensePlate: true } } },
  })
  return NextResponse.json(updated)
})

export const DELETE = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.loanerReservation.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.loanerReservation.update({ where: { id: params.id, garageId: session.user.garageId }, data: { status: 'cancelled' } })
  return NextResponse.json({ success: true })
})
