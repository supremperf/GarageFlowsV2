export const dynamic = 'force-dynamic'

/**
 * Staff-side SAV ticket (garage-scoped).
 *   GET  — ticket + message history.
 *   POST — staff reply (→ answered) or close/reopen. Body: { message?, close?, reopen? }
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { canReply, nextTicketStatus, type TicketStatus, type TicketAction } from '@/lib/portal/tickets'

export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const ticket = await prisma.portalTicket.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!ticket) return NextResponse.json({ error: 'Ticket introuvable' }, { status: 404 })
  return NextResponse.json({ ticket })
})

export const POST = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const ticket = await prisma.portalTicket.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!ticket) return NextResponse.json({ error: 'Ticket introuvable' }, { status: 404 })

  const action: TicketAction = body.reopen ? 'reopen' : body.close ? 'close' : 'staff_reply'
  const message = String(body.message ?? '').trim()

  if (action === 'staff_reply') {
    if (!message) return NextResponse.json({ error: 'Message requis' }, { status: 400 })
    if (!canReply(ticket.status as TicketStatus)) return NextResponse.json({ error: 'Ticket clôturé' }, { status: 409 })
    await prisma.$transaction([
      prisma.portalTicketMessage.create({
        data: { ticketId: ticket.id, authorType: 'staff', authorName: session.user.name ?? session.user.email, body: message },
      }),
      prisma.portalTicket.update({
        where: { id: ticket.id },
        data: { status: nextTicketStatus(ticket.status as TicketStatus, 'staff_reply'), lastMessageAt: new Date() },
      }),
    ])
    return NextResponse.json({ ok: true, status: 'answered' })
  }

  const status = nextTicketStatus(ticket.status as TicketStatus, action)
  await prisma.portalTicket.update({
    where: { id: ticket.id },
    data: { status, closedAt: action === 'close' ? new Date() : null },
  })
  return NextResponse.json({ ok: true, status })
})
