export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { toScaled } from '@/lib/money'
import { partToEuros } from '@/lib/money-db'

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

  const withEuros = parts.map(partToEuros) // + unitCost/unitPrice dérivés (euros)
  const result = lowStock ? withEuros.filter(p => p.quantity <= p.minQuantity) : withEuros
  return NextResponse.json(result)
})

// POST /api/parts
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const { name, reference, description, quantity = 0, minQuantity = 5, unitCost = 0, unitPrice = 0, location } = await req.json()

  if (!name?.trim()) return NextResponse.json({ error: 'Nom requis' }, { status: 400 })

  const part = await prisma.part.create({
    data: {
      name: name.trim(),
      reference: reference || null,
      description: description || null,
      quantity: Number(quantity),
      minQuantity: Number(minQuantity),
      unitCostTenThousandths: toScaled(Number(unitCost)), // € -> dix-milliemes exacts
      unitPriceTenThousandths: toScaled(Number(unitPrice)),
      location: location || null,
      garageId: session.user.garageId,
    },
  })
  return NextResponse.json(partToEuros(part), { status: 201 })
})
