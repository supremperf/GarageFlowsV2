export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

export const GET = withAuth(async () => {
  const session = await requireSession()
  // SQLite doesn't support column-to-column comparison in WHERE via Prisma,
  // so fetch all and filter in JS (part lists are small)
  const allParts = await prisma.part.findMany({
    where: { garageId: session.user.garageId },
    orderBy: { quantity: 'asc' },
  })
  const lowStock = allParts.filter(p => p.quantity <= p.minQuantity)
  return NextResponse.json(lowStock)
})
