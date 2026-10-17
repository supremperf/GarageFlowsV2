import { licenseApiBoundary } from '@/lib/license/api-boundary'
export const dynamic = 'force-dynamic'

/**
 * POST /api/sync/appointments — demandes de rendez-vous, dans les deux sens.
 *
 * ── Le défaut corrigé ───────────────────────────────────────────────────────
 * Une demande de rendez-vous n'est créée que par `/api/portal/appointments`,
 * c'est-à-dire depuis l'espace client — servi par le CLOUD. La voie de retour
 * ne rapatriait que les interventions, les notes et les photos. Sur un poste,
 * la table `Appointment` restait donc vide POUR TOUJOURS : le bouton
 * « Rendez-vous » ouvrait un panneau éternellement vide, et le garagiste en
 * concluait qu'aucun client ne demandait de rendez-vous.
 *
 * Ce n'est ni une erreur ni un refus — c'est un silence, et c'est pire : rien
 * n'invite à chercher. Chaque demande manquée est un client perdu.
 *
 * ── Deux mouvements ─────────────────────────────────────────────────────────
 *   `pull`   cloud → poste : les demandes du garage modifiées depuis un curseur.
 *   `answer` poste → cloud : la décision du garage, pour que le client la voie.
 *
 * Sans le second, le garage confirmerait un rendez-vous que son client verrait
 * encore « en attente » — un décalage plus dommageable que l'absence de la
 * fonctionnalité.
 *
 * ── Garanties ───────────────────────────────────────────────────────────────
 *   · identité par licence GARAGE GF2 ; `garageId` issu de la LICENCE ;
 *   · `answer` ne fixe pas un statut arbitraire : il rejoue l'ACTION à travers
 *     `nextAppointmentStatus`, la même machine à états que la route de session.
 *     Un poste ne doit pas pouvoir écrire « completed » sur une demande annulée ;
 *   · lecture bornée, curseur porté par le poste : un arriéré se rattrape en
 *     plusieurs passages plutôt qu'en une réponse démesurée.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateGarageLicense, shortId } from '@/lib/sync/garage-auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { nextAppointmentStatus, type AppointmentAction, type AppointmentStatus } from '@/lib/portal/appointments'
import { logger } from '@/lib/logger'

const FAILURE_STATUS: Record<string, number> = {
  MISSING_LICENSE: 400, LICENSE_INVALID: 403, NOT_A_GARAGE_LICENSE: 403,
  LICENSE_UNKNOWN: 403, LICENSE_REVOKED: 403, LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403, GARAGE_MISMATCH: 403,
  GARAGE_ALREADY_CLAIMED: 409, LICENSE_NOT_BOUND: 409,
}

/** Tranche maximale d'un passage : un arriéré se rattrape, il ne s'engloutit pas. */
const MAX_DEMANDES = 100

const chaine = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined

async function handlePOST(req: Request) {
  const rl = await enforceRateLimit('license_status', `appointments-sync:${clientIpFrom(req)}`)
  if (!rl.ok) return rateLimitResponse(rl)

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  const auth = await authenticateGarageLicense(body.garageLicense, null)
  if (!auth.ok) {
    logger.warn('[sync/appointments] refus auth', { code: auth.code })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }
  const garageId = auth.garageId as string
  const mode = chaine(body.mode) ?? 'pull'

  try {
    if (mode === 'pull') {
      const depuis = chaine(body.since)
      const borne = depuis ? new Date(depuis) : null
      const demandes = await prisma.appointment.findMany({
        // Portée garage explicite : sans elle, un poste lirait les rendez-vous
        // d'un autre garage.
        where: {
          garageId,
          ...(borne && !Number.isNaN(borne.getTime()) ? { updatedAt: { gt: borne } } : {}),
        },
        orderBy: { updatedAt: 'asc' },
        take: MAX_DEMANDES,
        select: {
          id: true, clientName: true, vehicleModel: true, licensePlate: true,
          reason: true, date: true, startTime: true, durationMin: true,
          status: true, notes: true, createdAt: true, updatedAt: true,
        },
      })
      return NextResponse.json({ ok: true, appointments: demandes })
    }

    if (mode === 'answer') {
      const id = chaine(body.appointmentId)
      const action = chaine(body.action) as AppointmentAction | undefined
      if (!id || !action) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })

      // Portée garage : la demande d'un autre garage est INTROUVABLE.
      const demande = await prisma.appointment.findFirst({
        where: { id, garageId },
        select: { id: true, status: true },
      })
      if (!demande) return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 })

      // La machine à états décide, pas le poste : rejouer l'ACTION interdit
      // d'écrire un statut impossible depuis l'état courant.
      const suivant = nextAppointmentStatus(demande.status as AppointmentStatus, action)
      if (!suivant) {
        return NextResponse.json(
          { ok: false, code: 'TRANSITION_REFUSEE', from: demande.status, action },
          { status: 409 },
        )
      }
      await prisma.appointment.update({ where: { id }, data: { status: suivant } })
      logger.info('[sync/appointments] décision appliquée', { garage: shortId(garageId), action })
      return NextResponse.json({ ok: true, status: suivant })
    }

    return NextResponse.json({ ok: false, code: 'UNKNOWN_MODE' }, { status: 400 })
  } catch (err) {
    throw err
  }
}

export async function POST(req: Request) {
  return licenseApiBoundary(() => handlePOST(req))
}
