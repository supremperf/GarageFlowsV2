export const dynamic = 'force-dynamic'

/**
 * POST /api/sync/job-photo — récupération, UNE PAR UNE, des photos prises par
 * un mécanicien depuis la PWA, pour les rapatrier sur le poste.
 *
 * Pourquoi un endpoint séparé de /api/sync/jobs : une photo pèse jusqu'à 8 Mo
 * et une intervention peut en porter 50. Les inclure dans la remontée
 * périodique produirait des réponses de plusieurs centaines de mégaoctets, non
 * reprenables en cas de coupure. Le poste demande donc les octets photo par
 * photo, à partir des métadonnées reçues, et peut s'arrêter à tout moment.
 *
 * Sécurité : même preuve que les autres passerelles (licence GARAGE GF2), et la
 * photo doit appartenir au garage authentifié — jamais un identifiant libre.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateGarageLicense, shortId } from '@/lib/sync/garage-auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { logger } from '@/lib/logger'

const FAILURE_STATUS: Record<string, number> = {
  MISSING_LICENSE: 400, LICENSE_INVALID: 403, NOT_A_GARAGE_LICENSE: 403,
  LICENSE_UNKNOWN: 403, LICENSE_REVOKED: 403, LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403, GARAGE_MISMATCH: 403,
}

export async function POST(req: Request) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  const garageId = typeof body.garageId === 'string' ? body.garageId.trim().slice(0, 64) : ''
  const photoId = typeof body.photoId === 'string' ? body.photoId.trim().slice(0, 64) : ''
  if (!garageId || !photoId) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  const auth = await authenticateGarageLicense(body.garageLicense, garageId)
  if (!auth.ok) {
    logger.warn('[sync/job-photo] refus auth', { code: auth.code, garage: shortId(garageId) })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }

  try {
    // Le garageId du filtre vient de la licence vérifiée : impossible de lire
    // la photo d'un autre garage même en connaissant son identifiant.
    const photo = await prisma.jobPhoto.findFirst({
      where: { id: photoId, garageId },
      select: { id: true, jobId: true, phase: true, caption: true, mechanicId: true, base64: true, createdAt: true },
    })
    if (!photo) return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 })
    if (!photo.base64) return NextResponse.json({ ok: false, code: 'NO_INLINE_DATA' }, { status: 409 })

    return NextResponse.json({ ok: true, photo })
  } catch (err) {
    logger.error('[sync/job-photo] erreur base', err)
    return NextResponse.json({ ok: false, code: 'SERVICE_UNAVAILABLE' }, { status: 503 })
  }
}
