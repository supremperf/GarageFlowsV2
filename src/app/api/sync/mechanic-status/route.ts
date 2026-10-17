import { licenseApiBoundary } from '@/lib/license/api-boundary'
export const dynamic = 'force-dynamic'

/**
 * POST /api/sync/mechanic-status — propagation POSTE → CLOUD d'un changement de
 * statut de clé mécanicien (suspension, réactivation, RÉVOCATION).
 *
 * Contrepartie INDISPENSABLE de /api/sync/mechanic-assignment : sans elle, une
 * clé révoquée par le patron sur son poste resterait ACTIVE sur
 * app.garageflows.fr et le mécanicien écarté conserverait l'accès à l'espace
 * mécanicien depuis son téléphone. Synchroniser l'octroi sans synchroniser le
 * retrait serait une régression de sécurité.
 *
 * Mêmes garanties que l'endpoint d'attribution : preuve d'identité par licence
 * GARAGE GF2 signée, `plid` signé vérifié, garageId issu de la licence,
 * recordMac recalculé, transaction unique, journalisation sans secret.
 *
 * Une RÉVOCATION est définitive : elle coupe aussi tous les appareils.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyLicenseToken } from '@/lib/license/verify'
import { computeRecordMac } from '@/lib/license/record-mac'
import { authenticateGarageLicense, shortId } from '@/lib/sync/garage-auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { logger } from '@/lib/logger'

const ALLOWED = new Set(['active', 'suspended', 'revoked'])

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

  const status = typeof body.status === 'string' ? body.status : ''
  const mechanicToken = typeof body.mechanicLicense === 'string' ? body.mechanicLicense.trim() : ''
  if (!ALLOWED.has(status) || !mechanicToken) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  const auth = await authenticateGarageLicense(body.garageLicense, null)
  if (!auth.ok) {
    logger.warn('[sync/mechanic-status] refus auth', { code: auth.code })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }

  const mv = verifyLicenseToken(mechanicToken)
  if (!mv.valid || !mv.payload || !mv.isMechanic) {
    return NextResponse.json({ ok: false, code: 'MECHANIC_LICENSE_INVALID' }, { status: 403 })
  }
  if (mv.payload.plid !== auth.licenseId) {
    return NextResponse.json({ ok: false, code: 'PARENT_MISMATCH' }, { status: 403 })
  }
  const mechLid = mv.payload.lid
  const now = new Date()

  try {
    const applied = await prisma.$transaction(async (tx) => {
      const record = await tx.licenseKey.findUnique({ where: { licenseId: mechLid } })
      if (!record || record.licenseType !== 'mechanic') return null

      // ─── Le lien parent doit tenir EN BASE, pas seulement dans le jeton ────
      // (GF-DUR-042) Le contrôle au-dessus porte sur `mv.payload.plid`, une
      // revendication SIGNÉE et donc figée à l'émission. Si la clé mécanicien
      // est ensuite réattribuée à un autre garage, `parentLicenseId` change en
      // base — mais l'ancien jeton, lui, continue de vérifier et de porter
      // l'ancien parent. Son détenteur pouvait alors suspendre ou révoquer une
      // clé qui ne lui appartient plus : un déni de service d'un garage sur le
      // mécanicien d'un autre.
      //
      // On exige donc que la base confirme le lien AU MOMENT de l'écriture,
      // dans la même transaction. Même logique que la garde
      // `isGarageClaimedByAnotherLicense` des routes voisines : une preuve
      // cryptographique dit qui a signé, jamais qui possède aujourd'hui.
      if (record.parentLicenseId !== auth.licenseId) return 'PARENT_MISMATCH'
      // Une clé déjà RÉVOQUÉE ne se réactive jamais (règle existante côté poste).
      if (record.status === 'revoked' && status !== 'revoked') return 'REVOKED_IS_FINAL'

      const recordMac = computeRecordMac({
        licenseId: record.licenseId, token: record.token, status,
        expiryAt: record.expiryAt, hwid: record.hwid,
        parentLicenseId: record.parentLicenseId, mechanicId: record.mechanicId,
      })
      await tx.licenseKey.update({
        where: { licenseId: mechLid },
        data: {
          status,
          recordMac,
          revokedAt:   status === 'revoked'   ? (record.revokedAt   ?? now) : null,
          suspendedAt: status === 'suspended' ? (record.suspendedAt ?? now) : null,
        },
      })
      // Suspension ou révocation : les appareils perdent l'accès immédiatement.
      if (status !== 'active') {
        await tx.licenseDevice.updateMany({
          where: { licenseId: mechLid, status: { in: ['active', 'deactivated'] } },
          data: status === 'revoked'
            ? { status: 'revoked', revokedAt: now, revokeReason: 'owner_revoke_sync' }
            : { status: 'deactivated' },
        })
      }
      return 'OK'
    })

    if (applied === null) return NextResponse.json({ ok: false, code: 'MECHANIC_KEY_UNKNOWN' }, { status: 409 })
    if (applied === 'REVOKED_IS_FINAL') return NextResponse.json({ ok: false, code: 'REVOKED_IS_FINAL' }, { status: 409 })
    // Le jeton était valide, mais la clé n'appartient plus à ce garage : c'est
    // un refus d'AUTORISATION, pas un conflit d'état (GF-DUR-042).
    if (applied === 'PARENT_MISMATCH') return NextResponse.json({ ok: false, code: 'PARENT_MISMATCH' }, { status: 403 })

    logger.info('[sync/mechanic-status] statut propagé', { key: shortId(mechLid), status, source: 'desktop', at: now.toISOString() })
    return NextResponse.json({ ok: true, licenseId: mechLid, status, syncedAt: now.toISOString() })
  } catch (err) {
    throw err
  }
}

export async function POST(req: Request) {
  return licenseApiBoundary(() => handlePOST(req))
}
