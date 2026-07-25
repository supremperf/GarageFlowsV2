export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { CreateClientSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'

// GET /api/clients?q=search&page=1&limit=20
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''

  const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20')))
  const skip  = (page - 1) * limit

  const where = {
    garageId: session.user.garageId,
    ...(q ? { name: { contains: q } } : {}),
  }

  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where,
      include: {
        vehicles: { select: { id: true, licensePlate: true, make: true, model: true, year: true } },
      },
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    prisma.client.count({ where }),
  ])

  return NextResponse.json({ data: clients, total, page, totalPages: Math.ceil(total / limit), limit })
})

// POST /api/clients
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = CreateClientSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  const { name, phone, email, address } = parsed.data

  if (!name?.trim()) return NextResponse.json({ error: 'Nom requis' }, { status: 400 })

  const client = await prisma.client.create({
    data: {
      name: name.trim(),
      phone: phone || null,
      email: email?.toLowerCase() || null,
      address: address || null,
      garageId: session.user.garageId,
    },
  })

  await logAudit({ action: 'create', entityType: 'Client', entityId: client.id, session, req })

  return NextResponse.json(client, { status: 201 })
})
