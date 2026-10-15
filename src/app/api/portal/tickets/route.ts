export const dynamic = 'force-dynamic'

/**
 * Portal SAV tickets (Phase 2).
 *   GET  — list the authenticated client's tickets.
 *   POST — open a ticket. Body: { subject, message, category?, priority?, vehicleId? }
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withPortalAuth } from '@/lib/portal/auth-helpers'
import { isTicketCategory, isTicketPriority } from '@/lib/portal/tickets'

export const GET = withPortalAuth(async (_req, { user }) => {
  const tickets = await prisma.portalTicket.findMany({
    where: { portalUserId: user.id },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
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

export const POST = withPortalAuth(async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const subject = String(body.subject ?? '').trim()
  const message = String(body.message ?? '').trim()
  if (!subject || !message) return NextResponse.json({ error: 'Sujet et message requis' }, { status: 400 })

  // Isolation : un vehicleId fourni doit être un véhicule DE CE client (même
  // garage). Sinon on refuse (rattachement à un véhicule arbitraire).
  let vehicleId: string | null = null
  if (typeof body.vehicleId === 'string' && body.vehicleId && user.clientId) {
    const owned = await prisma.vehicle.findFirst({
      where: { id: body.vehicleId, garageId: user.garageId, clientId: user.clientId },
      select: { id: true },
    })
    if (!owned) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 400 })
    vehicleId = owned.id
  }

  const ticket = await prisma.portalTicket.create({
    data: {
      garageId: user.garageId,
      portalUserId: user.id,
      clientId: user.clientId,
      vehicleId,
      subject,
      category: isTicketCategory(body.category) ? body.category : 'general',
      priority: isTicketPriority(body.priority) ? body.priority : 'normal',
      status: 'open',
      messages: { create: { authorType: 'client', authorName: user.name ?? user.email, body: message } },
    },
    include: { messages: true },
  })
  return NextResponse.json({ ok: true, ticket }, { status: 201 })
})
