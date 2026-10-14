export const dynamic = 'force-dynamic'

/**
 * POST   /api/admin/licenses/[id]/devices/[deviceId]  — { action: 'revoke'|'reset', reason? }
 *
 *  - revoke : révocation administrative — l'appareil est immédiatement invalidé
 *             (son deviceToken est refusé au prochain heartbeat) et NE PEUT PAS
 *             se réactiver seul.
 *  - reset  : réinitialisation — supprime l'appareil (libère le siège) et
 *             ré-autorise la machine à s'activer (règle métier : SAV/changement
 *             de poste).
 *
 * Authentification admin robuste (JWT gf_session typ=admin) + rate limit admin.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isAdminSession } from '@/lib/api-helpers'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { revokeDevice, resetDevice } from '@/lib/license/devices'
import { logger } from '@/lib/logger'

export async function POST(
  req: NextRequest,
  { params: pendingParams }: { params: Promise<{ id: string; deviceId: string }> }
) {
  const params = await pendingParams
  const rl = await enforceRateLimit('admin', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  if (!await isAdminSession()) {
    return NextResponse.json({ error: 'Accès refusé', code: 'FORBIDDEN' }, { status: 403 })
  }

  const id = parseInt(params.id, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'ID invalide', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  let action: string
  let reason: string | undefined
  try {
    const body = await req.json()
    action = String(body.action ?? '')
    reason = body.reason ? String(body.reason) : undefined
  } catch {
    return NextResponse.json({ error: 'Corps invalide', code: 'VALIDATION_ERROR' }, { status: 400 })
  }
  if (action !== 'revoke' && action !== 'reset') {
    return NextResponse.json(
      { error: 'Action invalide (revoke | reset)', code: 'VALIDATION_ERROR' },
      { status: 400 },
    )
  }

  try {
    // L'appareil doit appartenir à la licence ciblée (pas d'action inter-licences).
    const record = await prisma.licenseKey.findUnique({ where: { id } })
    if (!record) {
      return NextResponse.json({ error: 'Licence introuvable', code: 'NOT_FOUND' }, { status: 404 })
    }
    const device = await prisma.licenseDevice.findUnique({ where: { deviceId: params.deviceId } })
    if (!device || device.licenseId !== record.licenseId) {
      return NextResponse.json({ error: 'Appareil introuvable', code: 'NOT_FOUND' }, { status: 404 })
    }

    const done = action === 'revoke'
      ? await revokeDevice(params.deviceId, reason)
      : await resetDevice(params.deviceId)
    if (!done) {
      return NextResponse.json({ error: 'Appareil introuvable', code: 'NOT_FOUND' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, action })
  } catch (err) {
    logger.error('[admin/licenses/devices] action impossible', err)
    return NextResponse.json(
      { error: 'Une erreur interne est survenue.', code: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
