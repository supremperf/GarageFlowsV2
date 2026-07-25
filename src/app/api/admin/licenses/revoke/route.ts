export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/admin/licenses/revoke
 *
 * Change a license status: revoke, suspend, or reactivate.
 * Body: { licenseId, status: 'revoked' | 'suspended' | 'active' }
 * Auth: admin API key (Keygen) or admin session.
 *
 * If the license is not yet registered (client never activated), a tombstone
 * is created so the revoke/suspend is enforced the moment it does.
 */
import { NextRequest, NextResponse } from 'next/server'
import { setStatus, type LicenseStatus } from '@/lib/license/service'
import { adminGate, jsonError, readJson, serviceError } from '@/lib/license/http'

interface Body {
  licenseId?: string
  status?: string
}

export async function POST(req: NextRequest) {
  const gate = await adminGate(req)
  if (gate instanceof NextResponse) return gate

  const body = await readJson<Body>(req)
  if (!body) return jsonError(400, 'Corps de requête invalide')

  const licenseId = String(body.licenseId ?? '').trim()
  if (!licenseId) return jsonError(400, 'licenseId manquant')

  try {
    const r = await setStatus(licenseId, body.status as LicenseStatus, { ip: gate.ip })
    return r.ok
      ? NextResponse.json({ ok: true, licenseId: r.data.licenseId, status: r.data.status, label: r.data.label })
      : jsonError(r.status, r.error)
  } catch (e) {
    return serviceError(e)
  }
}
