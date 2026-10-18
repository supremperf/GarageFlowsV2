export const dynamic = 'force-dynamic'

/**
 * GET /api/tickets?status= — staff-side SAV ticket inbox (garage-scoped).
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  // Correspondance avec les clients : relève de la relation client, comme la
  // fiche elle-même. La route n'avait AUCUN contrôle : un mécanicien — qui n'a
  // ni `customer:manage` ni `financial:read` — pouvait lire toutes les
  // conversations du garage, y compris les litiges de facturation.
  if (!can(session.user.role, 'customer:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
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
