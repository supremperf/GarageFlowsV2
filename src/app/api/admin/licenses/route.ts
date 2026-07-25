export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET  /api/admin/licenses   — list all registered licenses (admin)
 * POST /api/admin/licenses   — alias of /create (register a signed token)
 */
import { NextRequest, NextResponse } from 'next/server'
import { listLicenses, createLicense } from '@/lib/license/service'
import { adminGate, jsonError, readJson, serviceError } from '@/lib/license/http'

export async function GET(req: NextRequest) {
  const gate = await adminGate(req)
  if (gate instanceof NextResponse) return gate
  try {
    const r = await listLicenses()
    return r.ok ? NextResponse.json(r.data) : jsonError(r.status, r.error)
  } catch (e) {
    return serviceError(e)
  }
}

export async function POST(req: NextRequest) {
  const gate = await adminGate(req)
  if (gate instanceof NextResponse) return gate
  const body = await readJson<Record<string, unknown>>(req)
  if (!body) return jsonError(400, 'Corps de requête invalide')
  try {
    const r = await createLicense(
      {
        token: body.token as string | undefined,
        customerId: body.customerId as string | undefined,
        licenseType: body.licenseType as string | undefined,
        years: body.years as number | undefined,
        seats: body.seats as number | undefined,
        hwid: (body.hwid as string | null | undefined) ?? null,
        label: (body.label as string | null | undefined) ?? null,
        notes: (body.notes as string | null | undefined) ?? null,
      },
      { ip: gate.ip },
    )
    return r.ok ? NextResponse.json(r.data, { status: 201 }) : jsonError(r.status, r.error)
  } catch (e) {
    return serviceError(e)
  }
}
