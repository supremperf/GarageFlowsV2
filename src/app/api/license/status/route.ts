import { licenseApiBoundary } from '@/lib/license/api-boundary'
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
 * Erreurs infra : codes dédiés 500/503 ; jamais allowed:true sur erreur DB/config.
 */

import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { prisma } from '@/lib/db'
import { verifyRecordMac, recordIntegrityUsable } from '@/lib/license/record-mac'
import { getAuthSecret } from '@/lib/auth-secret'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'


function getJwtSecret(): Uint8Array {
  // No hard-coded fallback — a missing/weak secret throws, translated by the outer boundary to SERVER_MISCONFIGURED.
  return new TextEncoder().encode(getAuthSecret())
}

const OK_UNKNOWN = { allowed: true, status: 'unknown' as const }

async function handleGET(req: NextRequest) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  // ── Resolve licenseId from the signed session cookie ────────────────────────
  const secret = getJwtSecret() // Configuration ≠ session invalide.
  const raw = req.cookies.get('gf_session')?.value
  if (!raw) return NextResponse.json(OK_UNKNOWN)

  let licenseId = ''
  try {
    const { payload } = await jwtVerify(raw, secret)
    licenseId = typeof payload.lid === 'string' ? payload.lid : ''
  } catch {
    return NextResponse.json(OK_UNKNOWN)
  }
  if (!licenseId) return NextResponse.json(OK_UNKNOWN)

  // ── Look up the current status in the DB ────────────────────────────────────
  try {
    const record = await prisma.licenseKey.findUnique({ where: { licenseId } })
    if (!record) return NextResponse.json(OK_UNKNOWN)

    // MAC absent = altération (GF31-AUD-005) : voir record-mac.ts.
    const mac = verifyRecordMac(record)
    if (!recordIntegrityUsable(mac)) {
      return NextResponse.json({
        allowed: false,
        status:  'tampered', code: 'LICENSE_TAMPERED',
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
    throw err
  }
}

export async function GET(req: NextRequest) {
  return licenseApiBoundary(() => handleGET(req))
}
