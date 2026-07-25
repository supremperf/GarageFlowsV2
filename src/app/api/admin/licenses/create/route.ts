export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/admin/licenses/create
 *
 * Register a license on the central server. Auth: admin API key (Keygen) or
 * admin session. Body either carries a pre-signed `token` (recommended — the
 * Keygen signs, the server only verifies + persists) or generation params
 * (server signs, requires GF_PRIVATE_KEY). Duplicates are rejected (409).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createLicense } from '@/lib/license/service'
import { adminGate, jsonError, readJson, serviceError } from '@/lib/license/http'

interface Body {
  token?: string
  customerId?: string
  licenseType?: string
  years?: number
  seats?: number
  hwid?: string | null
  label?: string | null
  notes?: string | null
}

export async function POST(req: NextRequest) {
  const gate = await adminGate(req)
  if (gate instanceof NextResponse) return gate

  const body = await readJson<Body>(req)
  if (!body) return jsonError(400, 'Corps de requête invalide')

  try {
    const r = await createLicense(
      {
        token: body.token,
        customerId: body.customerId,
        licenseType: body.licenseType,
        years: body.years,
        seats: body.seats,
        hwid: body.hwid ?? null,
        label: body.label ?? null,
        notes: body.notes ?? null,
      },
      { ip: gate.ip },
    )
    return r.ok ? NextResponse.json(r.data, { status: 201 }) : jsonError(r.status, r.error)
  } catch (e) {
    return serviceError(e)
  }
}
