import { licenseApiBoundary } from '@/lib/license/api-boundary'
export const dynamic = 'force-dynamic'

/**
 * POST /api/sync/portal — PUBLICATION d'un portail client depuis un POSTE.
 *
 * ─── Le problème résolu ─────────────────────────────────────────────────────
 * Corriger l'URL (`https://app.garageflows.fr/portal/<TOKEN>` au lieu d'une IP
 * LAN) ne suffisait pas : l'intervention d'un garage installé en local n'existe
 * que dans le SQLite du poste, et le jeton était signé avec le secret
 * d'installation du poste. La page s'ouvrait donc, mais l'API répondait
 * « Token invalide ou expiré ». Le client ne voyait rien.
 *
 * ─── Ce qui est publié (STRICTEMENT le nécessaire) ──────────────────────────
 * Le poste envoie l'INSTANTANÉ que la page portail affiche, déjà filtré à la
 * source (aucun `unitCost`, aucune marge, aucun autre client). Le cloud le
 * stocke tel quel dans `PortalSnapshot`, sans réplication de la base.
 *
 * ─── Sécurité ───────────────────────────────────────────────────────────────
 *   - identité du poste = licence GARAGE GF2 signée (lib/sync/garage-auth) ;
 *   - le jeton est signé ICI, avec le secret du CLOUD : le poste ne peut pas
 *     forger un jeton portail, il peut seulement en demander un POUR SON garage ;
 *   - `garageId` du jeton = celui de la licence, jamais un champ libre → aucune
 *     possibilité d'exposer l'intervention d'un autre garage ;
 *   - `jti` aléatoire : l'instantané est adressé par une clé imprévisible et le
 *     jeton complet n'est jamais stocké ;
 *   - expiration 7 jours, identique à la règle existante ;
 *   - taille du contenu bornée (refus au-delà) ;
 *   - journalisation sans secret.
 */
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { SignJWT } from 'jose'
import { prisma } from '@/lib/db'
import { portalSecret } from '@/lib/portal-secret'
import { publicUrlFor } from '@/lib/public-url'
import { cheminPortailToken } from '@/lib/portal/routes'
import { authenticateGarageLicense, isGarageClaimedByAnotherLicense, shortId } from '@/lib/sync/garage-auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { logger } from '@/lib/logger'

/** Le garage revendiqué appartient déjà à une AUTRE licence garage. */
class GarageAlreadyClaimed extends Error {}

/** Durée de validité du portail — règle métier existante, inchangée. */
const PORTAL_TTL_DAYS = 7
/** Borne de taille de l'instantané (photos incluses) : 4 Mio sérialisés. */
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024

const FAILURE_STATUS: Record<string, number> = {
  MISSING_LICENSE: 400, LICENSE_INVALID: 403, NOT_A_GARAGE_LICENSE: 403,
  LICENSE_UNKNOWN: 403, LICENSE_REVOKED: 403, LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403, GARAGE_MISMATCH: 403,
  // Revendication d'un garage déjà réservé / licence pas encore rattachée :
  // conflit d'état, pas un défaut d'authentification (GF31-AUD-003).
  GARAGE_ALREADY_CLAIMED: 409, LICENSE_NOT_BOUND: 409,
}

async function handlePOST(req: Request) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  const garageId = typeof body.garageId === 'string' ? body.garageId.trim() : ''
  const jobId    = typeof body.jobId === 'string' ? body.jobId.trim() : ''
  const payload  = body.payload
  if (!garageId || !jobId || !payload || typeof payload !== 'object') {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  const auth = await authenticateGarageLicense(body.garageLicense, garageId)
  if (!auth.ok) {
    logger.warn('[sync/portal] refus auth', { code: auth.code, garage: shortId(garageId) })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }
  // Le garage EFFECTIF vient de la licence dès qu'elle est rattachée.
  const trustedGarageId = auth.garageId ?? garageId

  const serialized = JSON.stringify(payload)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 })
  }

  // `jti` imprévisible : adresse l'instantané sans jamais stocker le jeton.
  const jtiNeuf = crypto.randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + PORTAL_TTL_DAYS * 86_400_000)
  // Identité RÉELLE de la publication : celle de l'instantané vivant s'il y en a
  // un (cf. bloc « une seule publication vivante », plus bas), sinon la neuve.
  let jti = jtiNeuf

  try {
    // Rattachement de la licence à la première utilisation (même règle partout).
    // Le contrôle « ce garage est-il déjà réservé ? » est REJOUÉ ici, dans la
    // même transaction que l'écriture : celui de `authenticateGarageLicense`
    // est fait hors transaction et resterait sujet à une course entre deux
    // licences revendiquant le même garage au même instant (GF31-AUD-003).
    if (!auth.garageId) {
      await prisma.$transaction(async (tx) => {
        if (await isGarageClaimedByAnotherLicense(tx, trustedGarageId, auth.licenseId)) {
          throw new GarageAlreadyClaimed()
        }
        await tx.licenseKey.updateMany({
          where: { licenseId: auth.licenseId, garageId: null },
          data:  { garageId: trustedGarageId },
        })
      })
    }

    // Une SEULE publication vivante par intervention — et TOUJOURS LA MÊME.
    //
    // Historique : chaque publication créait un instantané de plus et les
    // précédents restaient servis sept jours. Un garage qui s'apercevait qu'une
    // photo n'aurait pas dû être publiée ne pouvait pas se rétracter. La
    // première correction a fait REVOQUER la publication précédente à chaque
    // republication — ce qui a créé un défaut plus grave (GF-002) :
    //
    //   - l'ouverture d'une fiche d'intervention déclenche DEUX publications
    //     concurrentes (le QR code et le lien « copier » en demandaient chacun
    //     une) : la seconde tuait la première, si bien que le QR code affiché
    //     à l'écran pointait DÉJÀ vers un lien mort — « Lien invalide ou
    //     expiré » sur un lien qui venait d'être créé ;
    //   - rouvrir la fiche une semaine plus tard tuait le lien que le client
    //     avait reçu, sans que personne n'ait rien demandé.
    //
    // On REMPLOIE donc l'instantané vivant de l'intervention au lieu d'en créer
    // un autre : son identifiant, donc son URL, ne change plus. L'intention
    // d'origine reste entièrement satisfaite — le contenu est REMPLACÉ, donc ce
    // qui est retiré disparaît aussi de l'ancien lien. Ce qui disparaît, c'est
    // seulement la révocation ACCIDENTELLE d'une URL déjà distribuée.
    //
    // Un instantané PÉRIMÉ n'est pas remployé : sa republication rouvrirait un
    // lien que la règle des sept jours a déjà fermé.
    await prisma.$transaction(async (tx) => {
      const vivant = await tx.portalSnapshot.findFirst({
        where:   { garageId: trustedGarageId, jobId, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select:  { id: true },
      })
      if (vivant) jti = vivant.id

      // Les instantanés périmés de cette intervention, et tout doublon hérité
      // des publications d'avant cette correction, s'en vont maintenant : leur
      // lien est de toute façon inutilisable et ils n'ont plus à occuper de
      // place. L'instantané retenu est explicitement épargné.
      await tx.portalSnapshot.deleteMany({
        where: { garageId: trustedGarageId, jobId, id: { not: jti } },
      })
      await tx.portalSnapshot.upsert({
        where:  { id: jti },
        create: { id: jti, garageId: trustedGarageId, jobId, payload: serialized, expiresAt },
        update: { payload: serialized, expiresAt },
      })
    })

    // Purge opportuniste des instantanés périmés de CE garage (pas de tâche cron
    // nécessaire ; borne l'espace occupé).
    await prisma.portalSnapshot.deleteMany({
      where: { garageId: trustedGarageId, expiresAt: { lt: new Date() } },
    }).catch(() => ({ count: 0 }))

    const token = await new SignJWT({ typ: 'portal', jobId, garageId: trustedGarageId, jti })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(`${PORTAL_TTL_DAYS}d`)
      .sign(portalSecret())

    logger.info('[sync/portal] instantané publié', {
      garage: shortId(trustedGarageId), job: shortId(jobId),
      bytes: Buffer.byteLength(serialized, 'utf8'), expiresAt: expiresAt.toISOString(),
    })

    const path = cheminPortailToken(token)
    return NextResponse.json({ ok: true, token, path, url: publicUrlFor(path), expiresAt: expiresAt.toISOString() })
  } catch (err) {
    if (err instanceof GarageAlreadyClaimed) {
      logger.warn('[sync/portal] revendication refusée — garage déjà réservé', {
        garage: shortId(trustedGarageId), licence: shortId(auth.licenseId),
      })
      return NextResponse.json({ ok: false, code: 'GARAGE_ALREADY_CLAIMED' }, { status: 409 })
    }
    throw err
  }
}

export async function POST(req: Request) {
  return licenseApiBoundary(() => handlePOST(req))
}
