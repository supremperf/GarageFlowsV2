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
import { readPhotoAsDataUrl } from '@/lib/photo-store'
import { MECHANIC_PHOTO_MAX_BYTES } from '@/lib/mechanic-photo'

const FAILURE_STATUS: Record<string, number> = {
  MISSING_LICENSE: 400, LICENSE_INVALID: 403, NOT_A_GARAGE_LICENSE: 403,
  LICENSE_UNKNOWN: 403, LICENSE_REVOKED: 403, LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403, GARAGE_MISMATCH: 403,
  // Revendication d'un garage déjà réservé / licence pas encore rattachée :
  // conflit d'état, pas un défaut d'authentification (GF31-AUD-003).
  GARAGE_ALREADY_CLAIMED: 409, LICENSE_NOT_BOUND: 409,
}

export async function POST(req: Request) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  // REVENDICATION du client — jamais l'identité retenue (voir `garageId` plus bas).
  const claimedGarageId = typeof body.garageId === 'string' ? body.garageId.trim().slice(0, 64) : ''
  const photoId = typeof body.photoId === 'string' ? body.photoId.trim().slice(0, 64) : ''
  if (!claimedGarageId || !photoId) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  // Route de LECTURE seule : elle ne rattache aucune licence, donc elle exige
  // une licence déjà rattachée. Sans cela, le commentaire ci-dessous (« le
  // garageId du filtre vient de la licence vérifiée ») était FAUX : le filtre
  // utilisait la revendication du client, et n'importe quelle licence garage non
  // rattachée pouvait lire la photo d'un autre garage (GF31-AUD-003).
  const auth = await authenticateGarageLicense(body.garageLicense, claimedGarageId, { requireBound: true })
  if (!auth.ok) {
    logger.warn('[sync/job-photo] refus auth', { code: auth.code, garage: shortId(claimedGarageId) })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }
  // Identité EFFECTIVE, issue de la licence vérifiée.
  const garageId: string = auth.garageId as string

  try {
    // Le garageId du filtre vient de la licence vérifiée : impossible de lire
    // la photo d'un autre garage même en connaissant son identifiant.
    const photo = await prisma.jobPhoto.findFirst({
      where: { id: photoId, garageId },
      select: {
        id: true, jobId: true, phase: true, caption: true, mechanicId: true,
        base64: true, photoPath: true, createdAt: true,
      },
    })
    if (!photo) return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 })

    // ── Une photo écrite sur DISQUE doit redescendre elle aussi ───────────────
    // `POST /api/mechanic/jobs/[id]/photos` met `base64: ''` dès que le stockage
    // fichier est actif : la photo existait, était affichée dans la PWA, et
    // cette passerelle répondait pourtant « NO_INLINE_DATA ». Le poste la
    // redemandait à chaque passage sans jamais l'obtenir — le garage ne voyait
    // AUCUNE photo de son mécanicien, et le curseur de ce flux restait bloqué
    // sur elle. On relit donc le fichier quand la colonne est vide.
    // La borne de relecture est celle du dépôt d'une photo de mécanicien
    // (8 Mo) : le défaut de 2 Mo de `readPhotoAsDataUrl`, taillé pour un logo,
    // aurait rejeté silencieusement la plupart des photos d'atelier.
    const { photoPath, ...sansChemin } = photo
    const donnees = photo.base64 || readPhotoAsDataUrl(photoPath, MECHANIC_PHOTO_MAX_BYTES)
    if (!donnees) {
      // Ni colonne, ni fichier lisible : c'est un défaut de stockage côté
      // serveur, pas une demande invalide. Le poste passe au suivant.
      logger.warn('[sync/job-photo] octets introuvables', {
        garage: shortId(garageId), stockage: photoPath ? 'fichier' : 'aucun',
      })
      return NextResponse.json({ ok: false, code: 'NO_INLINE_DATA' }, { status: 409 })
    }

    return NextResponse.json({ ok: true, photo: { ...sansChemin, base64: donnees } })
  } catch (err) {
    logger.error('[sync/job-photo] erreur base', err)
    return NextResponse.json({ ok: false, code: 'SERVICE_UNAVAILABLE' }, { status: 503 })
  }
}
