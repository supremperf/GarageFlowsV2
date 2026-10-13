export const dynamic = 'force-dynamic'

/**
 * POST /api/sync/tickets — messagerie client, dans les deux sens.
 *
 * ── Le défaut corrigé ───────────────────────────────────────────────────────
 * Un ticket n'est créé que par `/api/portal/tickets`, depuis l'espace client —
 * servi par le CLOUD. Rien ne le rapatriait : sur un poste, la table
 * `PortalTicket` restait vide POUR TOUJOURS. Le bouton « Messages » ouvrait un
 * panneau éternellement vide, et le garagiste en concluait qu'aucun client ne
 * lui écrivait. Un client qui signale un problème et n'obtient jamais de réponse
 * ne renouvelle pas sa confiance.
 *
 * ── Trois mouvements ────────────────────────────────────────────────────────
 *   `pull`   cloud → poste : les conversations et leurs messages.
 *   `answer` poste → cloud : la réponse du garage, ou la clôture / réouverture.
 *
 * Rapatrier sans permettre de répondre aurait laissé le garage LIRE une demande
 * sans pouvoir y répondre — pire que de ne rien voir, puisqu'il saurait alors
 * qu'on l'attend.
 *
 * ── Garanties ───────────────────────────────────────────────────────────────
 *   · identité par licence GARAGE GF2 ; `garageId` issu de la LICENCE ;
 *   · `answer` rejoue l'ACTION à travers `nextTicketStatus`, la même machine à
 *     états que la route de session : un poste ne peut pas répondre dans une
 *     conversation clôturée ni inventer un statut ;
 *   · l'identité de l'AUTEUR client redescend réduite à ce que le garage doit
 *     afficher — jamais le haché de mot de passe, jamais le secret 2FA.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateGarageLicense, shortId } from '@/lib/sync/garage-auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { canReply, nextTicketStatus, type TicketAction, type TicketStatus } from '@/lib/portal/tickets'
import { logger } from '@/lib/logger'

const FAILURE_STATUS: Record<string, number> = {
  MISSING_LICENSE: 400, LICENSE_INVALID: 403, NOT_A_GARAGE_LICENSE: 403,
  LICENSE_UNKNOWN: 403, LICENSE_REVOKED: 403, LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403, GARAGE_MISMATCH: 403,
  GARAGE_ALREADY_CLAIMED: 409, LICENSE_NOT_BOUND: 409,
}

/** Tranche d'un passage : un arriéré se rattrape, il ne s'engloutit pas. */
const MAX_TICKETS = 50
/** Un message plus long que cela ne vient pas d'un formulaire de garage. */
const MAX_CORPS = 5_000

const chaine = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined

export async function POST(req: Request) {
  const rl = await enforceRateLimit('license_status', `tickets-sync:${clientIpFrom(req)}`)
  if (!rl.ok) return rateLimitResponse(rl)

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  const auth = await authenticateGarageLicense(body.garageLicense, null)
  if (!auth.ok) {
    logger.warn('[sync/tickets] refus auth', { code: auth.code })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }
  const garageId = auth.garageId as string
  const mode = chaine(body.mode) ?? 'pull'

  try {
    if (mode === 'pull') {
      const depuis = chaine(body.since)
      const borne = depuis ? new Date(depuis) : null
      const tickets = await prisma.portalTicket.findMany({
        // Portée garage explicite : sans elle, un poste lirait la
        // correspondance des clients d'un autre garage.
        where: {
          garageId,
          ...(borne && !Number.isNaN(borne.getTime()) ? { updatedAt: { gt: borne } } : {}),
        },
        orderBy: { updatedAt: 'asc' },
        take: MAX_TICKETS,
        select: {
          id: true, portalUserId: true, subject: true, category: true, priority: true,
          status: true, lastMessageAt: true, closedAt: true, createdAt: true, updatedAt: true,
          messages: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, authorType: true, authorName: true, body: true, createdAt: true },
          },
          // L'auteur est réduit à ce que le garage doit AFFICHER. Le haché de
          // mot de passe, les jetons et le secret 2FA ne redescendent jamais.
          portalUser: { select: { id: true, email: true, name: true } },
        },
      })
      return NextResponse.json({ ok: true, tickets })
    }

    if (mode === 'answer') {
      const id = chaine(body.ticketId)
      const action = chaine(body.action) as TicketAction | undefined
      if (!id || !action) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })

      // Portée garage : le ticket d'un autre garage est INTROUVABLE.
      const ticket = await prisma.portalTicket.findFirst({
        where: { id, garageId },
        select: { id: true, status: true },
      })
      if (!ticket) return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 })

      if (action === 'staff_reply') {
        const corps = chaine(body.message)
        const auteur = chaine(body.authorName) ?? 'Le garage'
        if (!corps) return NextResponse.json({ ok: false, code: 'MESSAGE_REQUIS' }, { status: 400 })
        if (corps.length > MAX_CORPS) {
          return NextResponse.json({ ok: false, code: 'MESSAGE_TROP_LONG' }, { status: 413 })
        }
        // Répondre dans une conversation clôturée n'a pas de sens : le client ne
        // la rouvrira pas pour lire.
        if (!canReply(ticket.status as TicketStatus)) {
          return NextResponse.json({ ok: false, code: 'TICKET_CLOTURE' }, { status: 409 })
        }
        await prisma.$transaction([
          prisma.portalTicketMessage.create({
            data: { ticketId: ticket.id, authorType: 'staff', authorName: auteur.slice(0, 120), body: corps },
          }),
          prisma.portalTicket.update({
            where: { id: ticket.id },
            data: {
              status: nextTicketStatus(ticket.status as TicketStatus, 'staff_reply'),
              lastMessageAt: new Date(),
            },
          }),
        ])
        logger.info('[sync/tickets] réponse du garage appliquée', { garage: shortId(garageId) })
        return NextResponse.json({ ok: true, status: 'answered' })
      }

      const suivant = nextTicketStatus(ticket.status as TicketStatus, action)
      await prisma.portalTicket.update({
        where: { id: ticket.id },
        data: { status: suivant, closedAt: action === 'close' ? new Date() : null },
      })
      return NextResponse.json({ ok: true, status: suivant })
    }

    return NextResponse.json({ ok: false, code: 'UNKNOWN_MODE' }, { status: 400 })
  } catch (err) {
    logger.error('[sync/tickets] erreur infra', err, { garage: shortId(garageId) })
    return NextResponse.json({ ok: false, code: 'INFRA' }, { status: 503 })
  }
}
