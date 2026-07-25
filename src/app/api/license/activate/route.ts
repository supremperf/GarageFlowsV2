export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/license/activate
 *
 * Activate a license against the CENTRAL server.
 *  1. Rate-limit (5 / 15 min per IP)
 *  2. Verify the ECDSA signature (verify.ts)
 *  3. service.activate() — the license MUST already exist on the server
 *     (created by the Keygen); status / expiry / HWID are enforced there.
 *  4. On success, set the signed gf_session cookie + UI indicator cookies.
 *
 * Body:    { license: string; hwid?: string }
 * Returns: { ok, isAdmin?, licenseType?, expiryAt?, seats?, reason? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { verifyLicenseToken } from '@/lib/license/verify'
import { activate } from '@/lib/license/service'
import { rateLimit } from '@/lib/rate-limit'
import { clientIp } from '@/lib/api-helpers'
import { getSessionSecretBytes } from '@/lib/security/session'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5 // 5 years

export async function POST(req: NextRequest) {
  const ip = clientIp(req) ?? 'local'
  const rl = rateLimit(`activate:${ip}`, 5, 15 * 60)
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, reason: `Trop de tentatives. Réessayez dans ${rl.retryAfter}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  let licenseToken: string
  let clientHwid: string | undefined
  try {
    const body = await req.json()
    licenseToken = String(body.license ?? '').trim()
    clientHwid = body.hwid ? String(body.hwid) : undefined
  } catch {
    return NextResponse.json({ ok: false, reason: 'Corps de requête invalide' }, { status: 400 })
  }

  if (!licenseToken) {
    return NextResponse.json({ ok: false, reason: 'Licence manquante' }, { status: 400 })
  }

  // Cryptographic verification first (cheap, no DB).
  const verified = verifyLicenseToken(licenseToken)
  if (!verified.valid || !verified.payload) {
    return NextResponse.json({ ok: false, reason: verified.reason })
  }

  // Authoritative server check (existence, status, expiry, HWID).
  let result
  try {
    result = await activate(verified.payload, licenseToken, clientHwid, { ip })
  } catch (err) {
    console.error('[license/activate] error:', (err as { code?: string })?.code ?? 'unknown')
    return NextResponse.json({ ok: false, reason: 'Serveur de licences indisponible. Réessayez.' }, { status: 503 })
  }

  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason, status: result.status })
  }

  // Signed session JWT — verified by middleware; prevents cookie tampering.
  const sessionJwt = await new SignJWT({ typ: result.licenseType, lid: result.lid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5y')
    .sign(getSessionSecretBytes())

  const res = NextResponse.json({
    ok: true,
    isAdmin: result.isAdmin ?? false,
    licenseType: result.licenseType,
    expiryAt: result.expiryAt,
    seats: result.seats ?? 1,
  })

  const base = `; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Strict`
  res.headers.append('Set-Cookie', `gf_session=${sessionJwt}${base}; HttpOnly`)
  res.headers.append('Set-Cookie', `gf_license_validated=1${base}`)
  res.headers.append('Set-Cookie', `gf_license_type=${result.licenseType}${base}`)

  return res
}
