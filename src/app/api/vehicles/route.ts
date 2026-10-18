export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { parsePagination } from '@/lib/pagination'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { CreateVehicleSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'

// GET /api/vehicles?plate=AB-123-CD  or  ?clientId=xxx&page=1&limit=15
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const plate = searchParams.get('plate') ?? ''
  const clientId = searchParams.get('clientId') ?? ''
  const q = searchParams.get('q') ?? ''

  const pagination = parsePagination(searchParams, 15)
  if (!pagination) return NextResponse.json({ error: 'Pagination invalide', code: 'INVALID_PAGINATION' }, { status: 400 })
  const { page, limit, skip } = pagination

  const where = {
    garageId: session.user.garageId,
    ...(plate ? { licensePlate: { contains: plate.toUpperCase() } } : {}),
    ...(clientId ? { clientId } : {}),
    ...(q ? {
      OR: [
        { licensePlate: { contains: q.toUpperCase() } },
        { make: { contains: q } },
        { model: { contains: q } },
        { client: { name: { contains: q } } },
      ],
    } : {}),
  }

  const [vehicles, total] = await Promise.all([
    prisma.vehicle.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, phone: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.vehicle.count({ where }),
  ])

  return NextResponse.json({ data: vehicles, total, page, totalPages: Math.ceil(total / limit), limit })
})

// POST /api/vehicles
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = CreateVehicleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  const { licensePlate, vin, make, model, year, mileage, color, notes, clientId } = parsed.data

  if (!licensePlate?.trim() || !make?.trim() || !model?.trim() || !clientId) {
    return NextResponse.json({ error: 'Plaque, marque, modèle et client requis' }, { status: 400 })
  }

  // Verify client belongs to garage
  const client = await prisma.client.findFirst({
    where: { id: clientId, garageId: session.user.garageId },
  })
  if (!client) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  // Upsert by plate+garageId
  const plate = licensePlate.trim().toUpperCase()
  const existing = await prisma.vehicle.findUnique({
    where: { licensePlate_garageId: { licensePlate: plate, garageId: session.user.garageId } },
  })

  if (existing) {
    const updated = await prisma.vehicle.update({
      where: { id: existing.id },
      data: { vin: vin || null, make: make.trim(), model: model.trim(), year: year ? Number(year) : null, mileage: mileage ? Number(mileage) : null, color: color || null, notes: notes || null, clientId },
      include: { client: { select: { id: true, name: true, phone: true, email: true } } },
    })

    await logAudit({ action: 'update', entityType: 'Vehicle', entityId: existing.id, session, req })

    return NextResponse.json(updated)
  }

  const vehicle = await prisma.vehicle.create({
    data: {
      licensePlate: plate,
      vin: vin || null,
      make: make.trim(),
      model: model.trim(),
      year: year ? Number(year) : null,
      mileage: mileage ? Number(mileage) : null,
      color: color || null,
      notes: notes || null,
      clientId,
      garageId: session.user.garageId,
    },
    include: { client: { select: { id: true, name: true, phone: true, email: true } } },
  })

  await logAudit({ action: 'create', entityType: 'Vehicle', entityId: vehicle.id, session, req })

  return NextResponse.json(vehicle, { status: 201 })
})
