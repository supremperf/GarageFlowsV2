export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const activeOnly = searchParams.get('activeOnly') === 'true'

  const vehicles = await prisma.loanerVehicle.findMany({
    where: { garageId: session.user.garageId, ...(activeOnly ? { isActive: true } : {}) },
    include: {
      reservations: {
        where: { status: { in: ['reserved', 'active'] } },
        orderBy: { startDate: 'asc' },
        take: 1,
        select: { id: true, clientName: true, startDate: true, endDate: true, status: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(vehicles)
})

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()
  if (!body.name?.trim()) return NextResponse.json({ error: 'name requis' }, { status: 400 })

  const vehicle = await prisma.loanerVehicle.create({
    data: {
      garageId: session.user.garageId,
      name:     body.name.trim(),
      licensePlate: body.licensePlate?.trim() ?? '',
      make:     body.make ?? null,
      model:    body.model ?? null,
      year:     body.year ? Number(body.year) : null,
      color:    body.color ?? null,
      notes:    body.notes ?? null,
      isActive: true,
    },
  })

  return NextResponse.json(vehicle, { status: 201 })
})
