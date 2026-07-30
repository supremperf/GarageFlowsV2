export const dynamic = 'force-dynamic'

/**
 * GET /api/license/status
 *
 * Lightweight, cookie-based revocation check polled continuously by the running
 * app (renderer). Unlike POST /api/license/check it needs no request body: the
 * licenseId is read from the signed `gf_session` cookie, so the client never has
 * to know its own licenseId. This works identically in Electron and on the web.
 *
 * Returns: { allowed: boolean; status: 'active'|'revoked'|'suspended'|'expired'|'tampered'|'unknown'; reason? }
 *
 * Indéterminé (pas de cookie, JWT invalide, record absent) → allowed=true
 * status='unknown' : un utilisateur légitime n'est jamais bloqué par un état
 * transitoire. Seul un état explicite revoked/suspended/expired/tampered bloque.
 *
 * Erreur infra : Electron → fail-open documenté (base locale) ; serveur/PWA →
 * 503 générique (le client UI ignore les réponses non-200 et conserve son état).
 */

import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { prisma } from '@/lib/db'
import { verifyRecordMac } from '@/lib/license/record-mac'
import { getAuthSecret } from '@/lib/auth-secret'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { logger } from '@/lib/logger'

const IS_ELECTRON = () => process.env.ELECTRON === '1'

function getJwtSecret(): Uint8Array {
  // No hard-coded fallback — a missing/weak secret throws, caught below → fail-open unknown.
  return new TextEncoder().encode(getAuthSecret())
}

const OK_UNKNOWN = { allowed: true, status: 'unknown' as const }

export async function GET(req: NextRequest) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  // ── Resolve licenseId from the signed session cookie ────────────────────────
  const raw = req.cookies.get('gf_session')?.value
  if (!raw) return NextResponse.json(OK_UNKNOWN)

  let licenseId = ''
  try {
    const { payload } = await jwtVerify(raw, getJwtSecret())
    licenseId = typeof payload.lid === 'string' ? payload.lid : ''
  } catch {
    return NextResponse.json(OK_UNKNOWN)
  }
  if (!licenseId) return NextResponse.json(OK_UNKNOWN)

  // ── Look up the current status in the DB ────────────────────────────────────
  try {
    const record = await prisma.licenseKey.findUnique({ where: { licenseId } })
    if (!record) return NextResponse.json(OK_UNKNOWN)

    const mac = verifyRecordMac(record)
    if (mac.tampered) {
      return NextResponse.json({
        allowed: false,
        status:  'tampered',
        reason:  'Intégrité de la base de données compromise.',
      })
    }

    if (record.status === 'revoked') {
      return NextResponse.json({
        allowed: false,
        status:  'revoked',
        reason:  'Cette licence a été révoquée.',
      })
    }
    if (record.status === 'suspended') {
      return NextResponse.json({
        allowed: false,
        status:  'suspended',
        reason:  'Cette licence est temporairement suspendue.',
      })
    }
    if (record.expiryAt.getTime() < Date.now()) {
      return NextResponse.json({
        allowed: false,
        status:  'expired',
        reason:  'Cette licence a expiré.',
      })
    }

    return NextResponse.json({ allowed: true, status: 'active' })
  } catch (err) {
    if (IS_ELECTRON()) {
      // Fail-open Electron : base locale indisponible ≠ licence invalide.
      return NextResponse.json(OK_UNKNOWN)
    }
    logger.error('[license/status] erreur infra', err)
    return NextResponse.json(
      { error: 'Service temporairement indisponible.', code: 'SERVICE_UNAVAILABLE' },
      { status: 503 },
    )
  }
}
