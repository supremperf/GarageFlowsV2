export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/admin/licenses/update
 *
 * Update a license: label / notes / seats, HWID change, status, or renewal
 * (either a re-signed `token` with the same licenseId, or `years` for a
 * server-side re-sign, or a direct `expiryAt`). Auth: admin API key or session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { updateLicense, type UpdateInput } from '@/lib/license/service'
import { adminGate, jsonError, readJson, serviceError } from '@/lib/license/http'

interface Body extends UpdateInput {
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
    const r = await updateLicense(
      licenseId,
      {
        label: body.label,
        notes: body.notes,
        seats: body.seats,
        hwid: body.hwid,
        status: body.status,
        years: body.years,
        token: body.token,
        expiryAt: body.expiryAt,
      },
      { ip: gate.ip },
    )
    return r.ok ? NextResponse.json(r.data) : jsonError(r.status, r.error)
  } catch (e) {
    return serviceError(e)
  }
}
