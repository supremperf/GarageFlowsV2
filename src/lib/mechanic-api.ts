/**
 * Helpers d'API pour l'espace MÉCANICIEN.
 *
 * `requireMechanic()` est le point de contrôle UNIQUE de toutes les routes
 * /api/mechanic/* : il revalide la session mécanicien en base (voir
 * validateMechanicSession) et renvoie un contexte de confiance {garageId,
 * mechanicId, licenseId}. Toute route mécanicien DOIT l'utiliser et n'utiliser
 * QUE ce contexte — jamais un garageId/mechanicId/role provenant du client.
 *
 * `withMechanic()` enveloppe le handler : rate limiting, Cache-Control:no-store
 * (aucune donnée mécanicien mise en cache HTTP partagé), et capture des
 * réponses d'erreur levées.
 */

import { NextResponse } from 'next/server'
import { resolveRouteContext } from '@/lib/route-context'
import { cookies } from 'next/headers'
import { validateMechanicSession, type MechanicContext } from '@/lib/license/mechanic-session'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/db'
import { syncWindow } from '@/lib/sync/job-fields'

/**
 * Vérifie la session mécanicien. Lève une NextResponse d'erreur (capturée par
 * withMechanic) si l'accès n'est pas autorisé. Sinon retourne le contexte de
 * confiance.
 */
export async function requireMechanic(): Promise<MechanicContext> {
  const raw = (await cookies()).get('gf_session')?.value ?? ''
  const check = await validateMechanicSession({ rawGfSession: raw })
  if (!check.ok) {
    throw NextResponse.json({ error: check.reason, code: check.code }, { status: check.status })
  }
  return check.ctx
}

/** En-têtes anti-cache pour toute réponse mécanicien (isolation par utilisateur). */
function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.headers.set('Pragma', 'no-cache')
  return res
}

/** Enveloppe un handler de route mécanicien. */
export function withMechanic(
  handler: (req: Request, ctx?: any) => Promise<NextResponse>,
) {
  return async (req: Request, ctx?: any): Promise<NextResponse> => {
    try {
      const rl = await enforceRateLimit('api', clientIpFrom(req))
      if (!rl.ok) return rateLimitResponse(rl)
      return noStore(await handler(req, await resolveRouteContext(ctx)))
    } catch (e) {
      if (e instanceof NextResponse) return noStore(e)
      logger.error('[Mechanic API Error]', e)
      return noStore(
        NextResponse.json(
          { error: 'Une erreur interne est survenue.', code: 'INTERNAL_ERROR' },
          { status: 500 },
        ),
      )
    }
  }
}

/**
 * Récupère UNE intervention attribuée au mécanicien courant, ou null.
 * Le scoping (garageId + mechanicId) provient EXCLUSIVEMENT du contexte de
 * session : impossible de lire l'intervention d'un autre mécanicien ou garage
 * en manipulant l'URL/le corps. Renvoie null (⇒ 404 générique) sinon — aucune
 * fuite sur l'existence de la ressource.
 */
export async function findAssignedJob(ctx: MechanicContext, jobId: string) {
  if (!jobId) return null
  // Bornée à la fenêtre effectivement synchronisée, comme la liste (GF-038).
  // Hors de cette fenêtre le miroir cloud n'est plus rafraîchi : ouvrir la
  // fiche y montrerait une affectation figée, potentiellement révoquée depuis
  // des semaines côté garage — et laisserait le mécanicien y pointer son
  // chrono.
  const fenetre = syncWindow(new Date())
  return prisma.job.findFirst({
    where: {
      id: jobId, garageId: ctx.garageId, mechanicId: ctx.mechanicId,
      date: { gte: fenetre.from, lte: fenetre.to },
    },
  })
}

/** Journalise une action mécanicien (jamais de secret/token). Fail-silent. */
export async function logMechanicAction(opts: {
  ctx: MechanicContext
  action: string
  jobId?: string | null
  targetType?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await prisma.mechanicActionAudit.create({
      data: {
        garageId: opts.ctx.garageId,
        // Action MÉCANICIEN : aucun acteur staff. La cible est le mécanicien lui-même.
        actorUserId: null,
        actorRole: null,
        targetMechanicId: opts.ctx.mechanicId,
        licenseId: opts.ctx.licenseId,
        jobId: opts.jobId ?? null,
        action: opts.action,
        targetType: opts.targetType ?? null,
        targetId: opts.targetId ?? null,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
      },
    })
  } catch (err) {
    logger.warn('[mechanic-audit] écriture impossible', err)
  }
}
