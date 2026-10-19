export const dynamic = 'force-dynamic'

/**
 * POST /api/keygen/licenses/[lid]/hwid — réinitialisation matérielle administrative.
 *
 * RÈGLE MÉTIER : une licence liée à un matériel refuse toute activation sur un
 * autre poste. C'est le comportement voulu. Mais un changement de machine
 * légitime (SAV, poste remplacé) doit rester possible — la décision appartient
 * à l'éditeur, pas au hasard d'un contournement.
 *
 * Actions :
 *  · `reset`  — supprime les appareils enregistrés (les sièges sont libérés) et
 *               efface la liaison matérielle de la ligne de licence. La machine
 *               peut se réactiver.
 *  · `revoke` — révoque les appareils actifs : ils restent bloqués jusqu'à une
 *               réinitialisation.
 *
 * HONNÊTETÉ SUR LA PORTÉE : si le JETON SIGNÉ porte lui-même un HWID
 * (`payload.hwid`), effacer la colonne ne suffit PAS — `/api/license/activate`
 * vérifie aussi la liaison signée. La réponse le dit explicitement
 * (`tokenBound: true`) au lieu de laisser croire qu'un « reset » a tout réglé :
 * il faut alors émettre une nouvelle licence. Aucune simulation de succès.
 *
 * AUTH : `x-gf-key` == GARAGEFLOW_API_KEY (temps constant, ≥ 16 caractères).
 * Le `recordMac` d'intégrité est recalculé dans la MÊME transaction que le
 * changement, comme partout ailleurs dans la chaîne licence.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { computeRecordMac } from '@/lib/license/record-mac'
import { listDevices, resetDevice, revokeDevice } from '@/lib/license/devices'
import { verifyLicenseToken } from '@/lib/license/verify'
import { logger } from '@/lib/logger'
import { isValidHwidFormat } from '@/lib/license/verify'

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
  const rl = await enforceRateLimit('admin', `keygen-hwid:${clientIpFrom(req)}`)
  if (!rl.ok) return rateLimitResponse(rl)

  if (!authorized(req)) {
    return NextResponse.json({ error: 'Accès refusé — clé API invalide' }, { status: 403 })
  }

  const lid = String(params.lid ?? '').trim()
  if (!lid) {
    return NextResponse.json({ error: 'LID manquant', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  let action: string
  let reason: string
  try {
    const body = await req.json()
    action = String(body.action ?? '').trim()
    reason = body.reason ? String(body.reason).slice(0, 200) : ''
  } catch {
    return NextResponse.json({ error: 'Corps invalide', code: 'VALIDATION_ERROR' }, { status: 400 })
  }
  if (action !== 'reset' && action !== 'revoke') {
    return NextResponse.json(
      { error: 'Action invalide (reset | revoke)', code: 'VALIDATION_ERROR' },
      { status: 400 },
    )
  }

  try {
    const record = await prisma.licenseKey.findUnique({ where: { licenseId: lid } })
    if (!record) {
      return NextResponse.json({ error: 'Licence introuvable', code: 'NOT_FOUND' }, { status: 404 })
    }

    const devices = await listDevices(lid)
    let touched = 0
    for (const d of devices) {
      if (action === 'revoke' && d.status === 'revoked') continue
      const done = action === 'reset' ? await resetDevice(d.deviceId) : await revokeDevice(d.deviceId, reason || undefined)
      if (done) touched++
    }

    // Liaison matérielle SIGNÉE : on la constate, on ne la contourne pas.
    const verified = verifyLicenseToken(record.token)
    const tokenBound = verified.valid && !!verified.payload?.hwid
    const tokenHwid = tokenBound ? String(verified.payload?.hwid) : null

    let cleared = false
    if (action === 'reset') {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const current = await tx.licenseKey.findUnique({ where: { licenseId: lid } })
        if (!current || !current.hwid) return
        const recordMac = computeRecordMac({
          licenseId:       current.licenseId,
          token:           current.token,
          status:          current.status,
          expiryAt:        current.expiryAt,
          hwid:            null,
          parentLicenseId: current.parentLicenseId ?? null,
          mechanicId:      current.mechanicId ?? null,
        })
        await tx.licenseKey.update({
          where: { id: current.id },
          data:  { hwid: null, recordMac },
        })
      })
      cleared = !!record.hwid
    }

    const note = tokenBound
      ? 'Attention : le jeton signé porte lui-même un HWID. La liaison matérielle de la base a été levée, '
        + 'mais ce jeton restera lié à son matériel d’origine : il faut émettre une NOUVELLE licence pour un autre poste.'
      : 'Aucune liaison matérielle dans le jeton signé : la licence peut s’activer sur un autre poste.'

    return NextResponse.json({
      ok: true,
      action,
      devicesTouched: touched,
      hwidCleared: cleared,
      tokenBound,
      tokenHwidValid: tokenHwid ? isValidHwidFormat(tokenHwid) : null,
      note,
    })
  } catch (err) {
    logger.error('[keygen/licenses/hwid] action impossible', err)
    return NextResponse.json(
      { error: 'Une erreur interne est survenue.', code: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
