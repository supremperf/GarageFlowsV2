export const dynamic = 'force-dynamic'

/**
 * GET /api/tickets?status= — staff-side SAV ticket inbox (garage-scoped).
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const status = new URL(req.url).searchParams.get('status')?.trim() || undefined

  const tickets = await prisma.portalTicket.findMany({
    where: { garageId: session.user.garageId, ...(status ? { status } : {}) },
    orderBy: { lastMessageAt: 'desc' },
    take: 200,
    include: { _count: { select: { messages: true } } },
  })
  return NextResponse.json({
    tickets: tickets.map(t => ({
      id: t.id, subject: t.subject, category: t.category, priority: t.priority,
      status: t.status, lastMessageAt: t.lastMessageAt, createdAt: t.createdAt,
      messageCount: t._count.messages,
    })),
  })
})
