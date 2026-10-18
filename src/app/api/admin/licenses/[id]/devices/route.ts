export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/licenses/[id]/devices
 *
 * Liste administrative des appareils d'une licence (pseudonymisée : deviceId
 * opaque, statut, horodatages — jamais de hwidHash/tokenHash). Authentification
 * admin robuste (JWT gf_session typ=admin) + rate limit catégorie admin.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isAdminSession } from '@/lib/api-helpers'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { listDevices, countActiveDevices } from '@/lib/license/devices'
import { logger } from '@/lib/logger'

export async function GET(
  req: NextRequest,
  { params: pendingParams }: { params: Promise<{ id: string }> }
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

  try {
    const record = await prisma.licenseKey.findUnique({ where: { id } })
    if (!record) {
      return NextResponse.json({ error: 'Licence introuvable', code: 'NOT_FOUND' }, { status: 404 })
    }
    const [devices, activeCount] = await Promise.all([
      listDevices(record.licenseId),
      countActiveDevices(record.licenseId),
    ])
    return NextResponse.json({ ok: true, seats: record.seats, activeCount, devices })
  } catch (err) {
    logger.error('[admin/licenses/devices] erreur infra', err)
    return NextResponse.json(
      { error: 'Une erreur interne est survenue.', code: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
