export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { coercePartField } from '@/lib/schemas'

// GET /api/parts?lowStock=true&repairType=xxx
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const lowStock = searchParams.get('lowStock') === 'true'
  const repairType = searchParams.get('repairType') ?? ''
  const q = searchParams.get('q') ?? ''

  // If repairType requested, get default parts for that type
  if (repairType) {
    const defaults = await prisma.repairTypePart.findMany({
      where: { repairType, garageId: session.user.garageId },
      include: { part: true },
    })
    return NextResponse.json(defaults)
  }

  const parts = await prisma.part.findMany({
    where: {
      garageId: session.user.garageId,
      ...(lowStock ? {} : {}), // filter below
      ...(q ? { OR: [{ name: { contains: q } }, { reference: { contains: q } }] } : {}),
    },
    orderBy: { name: 'asc' },
  })

  const result = lowStock ? parts.filter(p => p.quantity <= p.minQuantity) : parts
  return NextResponse.json(result)
})

// POST /api/parts
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  // SÉCURITÉ : coercition stricte (refuse objets/opérateurs Prisma, NaN, hors-bornes).
  const fields: Record<string, unknown> = {}
  for (const [f, def] of [['name', undefined], ['reference', null], ['description', null],
    ['quantity', 0], ['minQuantity', 5], ['unitCost', 0], ['unitPrice', 0], ['location', null]] as const) {
    const raw = f in body ? body[f] : def
    const v = coercePartField(f, raw)
    if (v instanceof Error) return NextResponse.json({ error: v.message }, { status: 400 })
    fields[f] = v
  }

  const part = await prisma.part.create({
    data: {
      name: fields.name as string,
      reference: fields.reference as string | null,
      description: fields.description as string | null,
      quantity: fields.quantity as number,
      minQuantity: fields.minQuantity as number,
      unitCost: fields.unitCost as number,
      unitPrice: fields.unitPrice as number,
      location: fields.location as string | null,
      garageId: session.user.garageId,
    },
  })
  return NextResponse.json(part, { status: 201 })
})
