export const dynamic = 'force-dynamic'

/**
 * GET /api/license/status
 *
 * Lightweight, cookie-based revocation check polled continuously by the running
 * app (renderer). Unlike POST /api/license/check it needs no request body: the
 * licenseId is read from the signed `gf_session` cookie, so the client never has
 * to know its own licenseId. This works identically in Electron and on the web.
 *
 * Returns: { allowed: boolean; status: 'active'|'revoked'|'suspended'|'tampered'|'unknown'; reason? }
 *
 * Fail-open: anything indeterminate (no cookie, bad JWT, record not found, DB
 * error) returns allowed=true so a legitimate user is never locked out by a
 * transient problem. Only an explicit revoked/suspended/tampered DB state blocks.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyRecordMac } from '@/lib/license/record-mac'
import { verifySessionJwt } from '@/lib/session-jwt'
import { logger } from '@/lib/logger'

const OK_UNKNOWN = { allowed: true, status: 'unknown' as const }

export async function GET(req: NextRequest) {
  // ── Resolve licenseId from the signed session cookie (rotation-aware) ───────
  const claims = await verifySessionJwt(req.cookies.get('gf_session')?.value)
  const licenseId = claims?.lid ?? ''
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

    return NextResponse.json({ allowed: true, status: 'active' })
  } catch (err) {
    logger.error('[license/status] DB error (fail-open):', err)
    return NextResponse.json(OK_UNKNOWN)
  }
}
