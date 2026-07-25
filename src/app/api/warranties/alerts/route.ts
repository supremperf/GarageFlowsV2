export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { addDays } from 'date-fns'

export const GET = withAuth(async () => {
  const session = await requireSession()
  const now = new Date()
  const in30 = addDays(now, 30)

  // Auto-expire warranties that have passed their expiresAt
  await prisma.warranty.updateMany({
    where: { garageId: session.user.garageId, status: 'active', expiresAt: { lt: now } },
    data: { status: 'expired' },
  })

  const [expiringSoon, justExpired] = await Promise.all([
    prisma.warranty.findMany({
      where: { garageId: session.user.garageId, status: 'active', expiresAt: { gte: now, lte: in30 } },
      orderBy: { expiresAt: 'asc' },
    }),
    prisma.warranty.findMany({
      where: { garageId: session.user.garageId, status: 'expired', expiresAt: { gte: addDays(now, -7) } },
      orderBy: { expiresAt: 'desc' },
      take: 10,
    }),
  ])

  return NextResponse.json({
    expiringSoon,
    justExpired,
    totalAlerts: expiringSoon.length + justExpired.length,
  })
})
