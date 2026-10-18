import { licenseApiBoundary } from '@/lib/license/api-boundary'
export const dynamic = 'force-dynamic'

/**
 * POST /api/sync/quote-return — voie de retour CLOUD → POSTE de l'accord client.
 *
 * Contrepartie INDISPENSABLE de /api/sync/quote : publier un devis pour qu'il
 * soit signé, sans jamais apprendre qu'il l'a été, laisserait le garage devant
 * un devis éternellement « envoyé » pendant que son client, lui, a signé. La
 * preuve d'acceptation resterait en outre dans le seul cloud — or c'est le
 * garage qui en a besoin en cas de litige.
 *
 * ── Ce qui redescend ─────────────────────────────────────────────────────────
 * Le nouveau statut (`accepted` / `refused`) ET le certificat scellé produit au
 * moment de l'accord : empreinte du document réellement affiché, horodatage,
 * adresse IP, agent utilisateur, le tout sous HMAC. Sans le certificat, le poste
 * n'aurait qu'un statut — c'est-à-dire exactement l'absence de preuve que la
 * signature du portail avait pour objet de corriger.
 *
 * ── Curseur ──────────────────────────────────────────────────────────────────
 * Le poste envoie la date de la dernière preuve qu'il détient. Aucun état n'est
 * conservé côté cloud : un poste réinstallé, ou une base restaurée, redemande
 * simplement depuis sa propre réalité. Le curseur est reculé côté poste pour
 * absorber les écritures concurrentes (même raison que la voie de retour des
 * interventions).
 *
 * ── Garanties ────────────────────────────────────────────────────────────────
 *   · identité par licence GARAGE GF2 signée ; `garageId` issu de la LICENCE ;
 *   · lecture SEULE — cette route n'écrit rien, elle ne peut donc rien casser ;
 *   · bornée : au plus MAX_PREUVES par passage, le reste au passage suivant.
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
  GARAGE_ALREADY_CLAIMED: 409, LICENSE_NOT_BOUND: 409,
}

/**
 * Tranche par passage. Volontairement modeste : chaque preuve porte un
 * instantané canonique du document, ce n'est pas une ligne de quelques octets.
 */
const MAX_PREUVES = 50

async function handlePOST(req: Request) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
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
    logger.warn('[sync/quote-return] refus auth', { code: auth.code })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }
  const garageId = auth.garageId as string

  const depuis = typeof body.since === 'string' ? new Date(body.since) : null
  const since = depuis && !Number.isNaN(depuis.getTime()) ? depuis : null

  try {
    const preuves = await prisma.signature.findMany({
      where: {
        garageId,
        entityType: 'quote',
        invalidatedAt: null,
        ...(since ? { signedAt: { gt: since } } : {}),
      },
      orderBy: { signedAt: 'asc' },
      take: MAX_PREUVES + 1,
    })

    const reste = preuves.length > MAX_PREUVES
    const tranche = reste ? preuves.slice(0, MAX_PREUVES) : preuves

    // Statut courant des devis concernés — c'est lui qui fait foi, pas la
    // présence d'une preuve : un devis peut avoir été converti depuis.
    const statuts = tranche.length
      ? await prisma.quote.findMany({
        where: { garageId, id: { in: Array.from(new Set(tranche.map((p) => p.entityId))) } },
        select: { id: true, status: true },
      })
      : []
    const statutParDevis = new Map(statuts.map((q) => [q.id, q.status]))

    logger.info('[sync/quote-return] preuves servies', {
      garage: shortId(garageId), preuves: tranche.length, reste,
    })

    return NextResponse.json({
      ok: true,
      reste,
      signatures: tranche.map((p) => ({
        id: p.id,
        quoteId: p.entityId,
        quoteStatus: statutParDevis.get(p.entityId) ?? null,
        signerName: p.signerName,
        signerRole: p.signerRole,
        algorithm: p.algorithm,
        contentHash: p.contentHash,
        imageHash: p.imageHash,
        seal: p.seal,
        signatureData: p.signatureData,
        documentSnapshotJson: p.documentSnapshotJson,
        ipAddress: p.ipAddress,
        userAgent: p.userAgent,
        signedAt: p.signedAt.toISOString(),
      })),
    })
  } catch (err) {
    throw err
  }
}

export async function POST(req: Request) {
  return licenseApiBoundary(() => handlePOST(req))
}
