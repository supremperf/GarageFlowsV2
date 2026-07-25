export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { LABOR_DEFAULTS } from '@/lib/labor-defaults'

// GET /api/labor-operations
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const category = searchParams.get('category') ?? ''
  const activeParam = searchParams.get('active')

  const where: Record<string, unknown> = {
    garageId: session.user.garageId,
  }
  if (activeParam === 'true') where.isActive = true
  else if (activeParam === 'false') where.isActive = false

  if (category) where.category = category

  if (q) {
    where.name = { contains: q }
  }

  const operations = await prisma.laborOperation.findMany({
    where,
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })

  return NextResponse.json({ operations, defaults: LABOR_DEFAULTS })
})

// POST /api/labor-operations
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()
  const { name, category, durationMin = 30, unitPrice = 0, description, isActive = true } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Le nom est requis' }, { status: 400 })
  }
  if (Number(durationMin) < 1) {
    return NextResponse.json({ error: 'La durée doit être d\'au moins 1 minute' }, { status: 400 })
  }
  if (Number(unitPrice) < 0) {
    return NextResponse.json({ error: 'Le prix ne peut pas être négatif' }, { status: 400 })
  }

  const operation = await prisma.laborOperation.create({
    data: {
      name: name.trim(),
      category: category || null,
      durationMin: Number(durationMin),
      unitPrice: Number(unitPrice),
      description: description || null,
      isActive: Boolean(isActive),
      garageId: session.user.garageId,
    },
  })

  return NextResponse.json(operation, { status: 201 })
})
