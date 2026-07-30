export const dynamic = 'force-dynamic'

/**
 * Portal SAV ticket detail (Phase 2).
 *   GET  — the ticket and its message history.
 *   POST — the client replies. Body: { message }  (reopens if needed → pending).
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withPortalAuth } from '@/lib/portal/auth-helpers'
import { canReply, nextTicketStatus, type TicketStatus } from '@/lib/portal/tickets'

type RouteCtx = { params: { id: string } }

export const GET = withPortalAuth<RouteCtx>(async (_req, { user }, { params }) => {
  const ticket = await prisma.portalTicket.findFirst({
    where: { id: params.id, portalUserId: user.id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!ticket) return NextResponse.json({ error: 'Ticket introuvable' }, { status: 404 })
  return NextResponse.json({ ticket })
})

export const POST = withPortalAuth<RouteCtx>(async (req, { user }, { params }) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const message = String(body.message ?? '').trim()
  if (!message) return NextResponse.json({ error: 'Message requis' }, { status: 400 })

  const ticket = await prisma.portalTicket.findFirst({ where: { id: params.id, portalUserId: user.id } })
  if (!ticket) return NextResponse.json({ error: 'Ticket introuvable' }, { status: 404 })
  if (!canReply(ticket.status as TicketStatus)) {
    return NextResponse.json({ error: 'Ce ticket est clôturé' }, { status: 409 })
  }

  const now = new Date()
  await prisma.$transaction([
    prisma.portalTicketMessage.create({
      data: { ticketId: ticket.id, authorType: 'client', authorName: user.name ?? user.email, body: message },
    }),
    prisma.portalTicket.update({
      where: { id: ticket.id },
      data: { status: nextTicketStatus(ticket.status as TicketStatus, 'client_reply'), lastMessageAt: now },
    }),
  ])

  return NextResponse.json({ ok: true, status: 'pending' })
})
