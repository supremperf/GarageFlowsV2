export const dynamic = 'force-dynamic'

/**
 * GET /api/appointments?status=&date= — staff-side appointment list (garage-scoped).
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')?.trim() || undefined
  const date = searchParams.get('date')?.trim() || undefined

  const appointments = await prisma.appointment.findMany({
    where: { garageId: session.user.garageId, ...(status ? { status } : {}), ...(date ? { date } : {}) },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    take: 200,
  })
  return NextResponse.json({ appointments })
})
