import { licenseApiBoundary } from '@/lib/license/api-boundary'
export const dynamic = 'force-dynamic'

/**
 * GET /api/license/devices
 *
 * Liste PSEUDONYMISÉE des appareils de SA PROPRE licence — le licenseId est lu
 * dans le cookie signé gf_session (jamais fourni par le client). Aucun haché
 * (hwidHash/tokenHash) n'est exposé : uniquement deviceId opaque, statut,
 * plateforme et horodatages.
 *
 * Returns: { ok, seats, activeCount, devices: [{ deviceId, status, name, platform, appVersion, firstActivatedAt, lastSeenAt, revokedAt }] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { prisma } from '@/lib/db'
import { getAuthSecret } from '@/lib/auth-secret'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { listDevices, countActiveDevices } from '@/lib/license/devices'

async function handleGET(req: NextRequest) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  const secret = new TextEncoder().encode(getAuthSecret())
  const raw = req.cookies.get('gf_session')?.value
  if (!raw) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHENTICATED', reason: 'Session requise' },
      { status: 401 },
    )
  }

  let licenseId = ''
  try {
    const { payload } = await jwtVerify(raw, secret)
    licenseId = typeof payload.lid === 'string' ? payload.lid : ''
  } catch {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHENTICATED', reason: 'Session invalide' },
      { status: 401 },
    )
  }
  if (!licenseId) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHENTICATED', reason: 'Session invalide' },
      { status: 401 },
    )
  }

  try {
    const record = await prisma.licenseKey.findUnique({ where: { licenseId } })
    if (!record) {
      return NextResponse.json(
        { ok: false, code: 'NOT_FOUND', reason: 'Licence introuvable' },
        { status: 404 },
      )
    }
    const [devices, activeCount] = await Promise.all([
      listDevices(licenseId),
      countActiveDevices(licenseId),
    ])
    return NextResponse.json({ ok: true, seats: record.seats, activeCount, devices })
  } catch (err) {
    throw err
  }
}

export async function GET(req: NextRequest) {
  return licenseApiBoundary(() => handleGET(req))
}
