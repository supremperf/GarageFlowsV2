export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/tickets/[id]/close — the client closes (or reopens) a ticket.
 * Body: { reopen?: boolean }
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withPortalAuth } from '@/lib/portal/auth-helpers'
import { nextTicketStatus, type TicketStatus } from '@/lib/portal/tickets'

type RouteCtx = { params: { id: string } }

export const POST = withPortalAuth<RouteCtx>(async (req, { user }, { params }) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const reopen = body.reopen === true

  const ticket = await prisma.portalTicket.findFirst({ where: { id: params.id, portalUserId: user.id } })
  if (!ticket) return NextResponse.json({ error: 'Ticket introuvable' }, { status: 404 })

  const status = nextTicketStatus(ticket.status as TicketStatus, reopen ? 'reopen' : 'close')
  await prisma.portalTicket.update({
    where: { id: ticket.id },
    data: { status, closedAt: reopen ? null : new Date() },
  })
  return NextResponse.json({ ok: true, status })
})
