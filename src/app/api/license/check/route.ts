export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET  /api/license/check?licenseId=...
 * POST /api/license/check   { licenseId }
 *
 * Periodic validation heartbeat used by running clients. The central server is
 * authoritative: it returns a definitive verdict.
 *   - found     → { allowed, status: active|revoked|suspended|expired }
 *   - not found → { allowed: false, status: 'unknown' }  (server has no such license)
 *
 * A CLIENT distinguishes this definitive answer from a NETWORK failure (no
 * response at all) — on a network failure it keeps its cached state (grace
 * window), so the server always has the last word without desyncing offline.
 */
import { NextRequest, NextResponse } from 'next/server'
import { validateById } from '@/lib/license/service'
import { clientIp } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'

async function handle(licenseId: string, req: NextRequest) {
  if (!licenseId) {
    return NextResponse.json({ allowed: false, status: 'unknown', reason: 'licenseId manquant' }, { status: 400 })
  }
  const ip = clientIp(req) ?? 'local'
  if (!rateLimit(`lic-check:${ip}`, 120, 60).ok) {
    return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 })
  }
  try {
    const verdict = await validateById(licenseId, { ip })
    return NextResponse.json(verdict)
  } catch (err) {
    // DB/infra error → indeterminate. Fail-open so a transient server problem
    // never locks out a legitimate client; the next check re-evaluates.
    console.error('[license/check] error:', (err as { code?: string })?.code ?? 'unknown')
    return NextResponse.json({ allowed: true, status: 'unknown' })
  }
}

export async function GET(req: NextRequest) {
  const licenseId = (req.nextUrl.searchParams.get('licenseId') ?? '').trim()
  return handle(licenseId, req)
}

export async function POST(req: NextRequest) {
  let licenseId = ''
  try {
    const body = await req.json()
    licenseId = String(body.licenseId ?? '').trim()
  } catch {
    return NextResponse.json({ allowed: false, status: 'unknown', reason: 'Requête invalide' }, { status: 400 })
  }
  return handle(licenseId, req)
}
