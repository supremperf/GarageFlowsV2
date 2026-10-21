export const dynamic = 'force-dynamic'

/**
 * POST /api/keygen/licenses/[lid]/status — changement de statut depuis le Keygen.
 *
 * POURQUOI CETTE ROUTE EXISTE : le Keygen gérait les statuts via
 * `/api/admin/licenses/revoke-by-key`, retirée définitivement (une clé partagée
 * ne constitue pas une authentification admin forte). Depuis, révoquer ou
 * suspendre depuis le Keygen échouait en 404 sans que rien ne le dise vraiment :
 * l'outil mettait sa base locale à jour, le serveur ignorait tout, et le poste
 * licencié continuait de fonctionner. Le statut local et le statut réel
 * divergeaient silencieusement — le pire défaut possible sur une révocation.
 *
 * Cette route rétablit la capacité, sur le modèle de `/api/admin/licenses/create`
 * (même en-tête, même comparaison à temps constant), en reprenant la machine à
 * états et le recalcul de `recordMac` de la route admin de session :
 *  · `revoked` reste TERMINAL (réactivation = geste dédié + motif ≥ 5 caractères) ;
 *  · le MAC d'intégrité est recalculé dans la MÊME transaction que l'écriture ;
 *  · chaque transition laisse un événement daté, avec l'acteur (`keygen:<ip>`).
 *
 * Corps : { status: 'active'|'suspended'|'revoked', confirmReactivation?: boolean, reason?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { computeRecordMac } from '@/lib/license/record-mac'
import { canTransitionLicense, auditActionFor, type SettableLicenseState } from '@/lib/license/state-machine'
import { logger } from '@/lib/logger'

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

function authorized(req: NextRequest): boolean {
  const serverApiKey = process.env.GARAGEFLOW_API_KEY?.trim() ?? ''
  if (!serverApiKey || serverApiKey.length < 16) return false
  const apiKey = req.headers.get('x-gf-key')?.trim() ?? ''
  if (!apiKey) return false
  return safeEqual(apiKey, serverApiKey)
}

export async function POST(
  req: NextRequest,
  { params: pendingParams }: { params: Promise<{ lid: string }> },
) {
  const params = await pendingParams
  const rl = await enforceRateLimit('admin', `keygen-status:${clientIpFrom(req)}`)
  if (!rl.ok) return rateLimitResponse(rl)

  if (!authorized(req)) {
    return NextResponse.json({ error: 'Accès refusé — clé API invalide' }, { status: 403 })
  }

  const lid = String(params.lid ?? '').trim()
  if (!lid) {
    return NextResponse.json({ error: 'LID manquant', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  let body: { status?: unknown; confirmReactivation?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corps invalide', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  try {
    const record = await prisma.licenseKey.findUnique({ where: { licenseId: lid } })
    if (!record) {
      // Une clé jamais enregistrée côté serveur ne peut pas changer de statut :
      // on le dit, au lieu de créer une pierre tombale silencieuse.
      return NextResponse.json(
        { error: 'Licence introuvable sur le serveur (enregistrez-la d’abord).', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    const verdict = canTransitionLicense({
      from:               record.status,
      to:                 body.status,
      confirmReactivation: body.confirmReactivation === true,
      reason:             body.reason,
    })
    if (!verdict.ok) {
      const http = verdict.code === 'INVALID_STATUS' ? 400 : 409
      return NextResponse.json({ error: verdict.message, code: verdict.code }, { status: http })
    }

    const next = body.status as SettableLicenseState
    const acteur = `keygen:${clientIpFrom(req)}`
    const motif = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null

    if (verdict.kind === 'noop') {
      return NextResponse.json({ ok: true, status: record.status, unchanged: true })
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const recordMac = computeRecordMac({
        licenseId:       record.licenseId,
        token:           record.token,
        status:          next,
        expiryAt:        record.expiryAt,
        hwid:            record.hwid ?? null,
        parentLicenseId: record.parentLicenseId ?? null,
        mechanicId:      record.mechanicId ?? null,
      })
      await tx.licenseKey.update({
        where: { id: record.id },
        data: {
          status:    next,
          recordMac,
          revokedAt: next === 'revoked' ? new Date() : next === 'active' ? null : record.revokedAt,
        },
      })
      await tx.licenseDeviceEvent.create({
        data: {
          licenseId: record.licenseId,
          deviceId:  null,
          action:    auditActionFor(next, verdict.kind),
          detail: JSON.stringify({
            from: record.status, to: next, actor: acteur, reason: motif,
            at: new Date().toISOString(),
          }),
        },
      })
    })

    return NextResponse.json({
      ok: true,
      status: next,
      previousStatus: record.status,
      reactivation: verdict.kind === 'reactivation',
      note: next === 'revoked'
        ? 'Licence révoquée : les postes licenciés sont bloqués à la prochaine vérification.'
        : undefined,
    })
  } catch (err) {
    logger.error('[keygen/licenses/status] transition impossible', err)
    return NextResponse.json(
      { error: 'Une erreur interne est survenue.', code: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
