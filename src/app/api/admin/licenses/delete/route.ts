export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/admin/licenses/delete
 *
 * Permanently delete a license (and its audit events) from the central server.
 * Body: { licenseId }. Auth: admin API key (Keygen) or admin session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { deleteLicense } from '@/lib/license/service'
import { adminGate, jsonError, readJson, serviceError } from '@/lib/license/http'

interface Body {
  licenseId?: string
}

export async function POST(req: NextRequest) {
  const gate = await adminGate(req)
  if (gate instanceof NextResponse) return gate

  const body = await readJson<Body>(req)
  if (!body) return jsonError(400, 'Corps de requête invalide')

  const licenseId = String(body.licenseId ?? '').trim()
  if (!licenseId) return jsonError(400, 'licenseId manquant')

  try {
    const r = await deleteLicense(licenseId, { ip: gate.ip })
    return r.ok ? NextResponse.json({ ok: true, licenseId }) : jsonError(r.status, r.error)
  } catch (e) {
    return serviceError(e)
  }
}
