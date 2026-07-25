export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/license/status
 *
 * Cookie-based validation used by the running renderer. The licenseId is read
 * from the signed gf_session cookie, so the client never needs to know it.
 * Delegates to the same authoritative evaluation as /api/license/check.
 *
 * Returns: { allowed, status: 'active'|'revoked'|'suspended'|'expired'|'unknown', reason? }
 *
 * Fail-open on anything indeterminate (no cookie, bad JWT, infra error) so a
 * transient problem never locks out a legitimate user. Only an explicit
 * revoked/suspended/expired verdict blocks.
 */
import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { getSessionSecretBytes } from '@/lib/security/session'
import { validateById } from '@/lib/license/service'
import { clientIp } from '@/lib/api-helpers'

const OK_UNKNOWN = { allowed: true, status: 'unknown' as const }

export async function GET(req: NextRequest) {
  const raw = req.cookies.get('gf_session')?.value
  if (!raw) return NextResponse.json(OK_UNKNOWN)

  let licenseId = ''
  try {
    const { payload } = await jwtVerify(raw, getSessionSecretBytes())
    licenseId = typeof payload.lid === 'string' ? payload.lid : ''
  } catch {
    return NextResponse.json(OK_UNKNOWN)
  }
  if (!licenseId) return NextResponse.json(OK_UNKNOWN)

  try {
    const verdict = await validateById(licenseId, { ip: clientIp(req) })
    return NextResponse.json(verdict)
  } catch (err) {
    console.error('[license/status] error (fail-open):', (err as { code?: string })?.code ?? 'unknown')
    return NextResponse.json(OK_UNKNOWN)
  }
}
