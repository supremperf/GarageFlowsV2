export const dynamic = 'force-dynamic'

/**
 * POST /api/license/activate
 *
 * Server-side license validation using ECDSA-SHA256.
 * The private key NEVER leaves the server — the browser only submits a token.
 *
 * Flow:
 *  1. Rate-limit check (5 attempts / 15 min per IP)
 *  2. Cryptographic ECDSA signature verification (via verify.ts)
 *  3. DB revocation / suspension check
 *  4. Optional HWID binding check
 *  5. Set signed session cookie + plain indicator cookies via Set-Cookie headers
 *
 * Body:    { license: string; hwid?: string }
 * Returns: { ok, isAdmin?, licenseType?, expiryAt?, seats?, reason? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { verifyLicenseToken, verifyHwid } from '@/lib/license/verify'
import { prisma } from '@/lib/db'
import { computeRecordMac, verifyRecordMac } from '@/lib/license/record-mac'
import { rateLimit } from '@/lib/rate-limit'
import { getSessionSecret } from '@/lib/session-secret'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5   // 5 years

export async function POST(req: NextRequest) {
  // ── Step 0: Rate limiting ───────────────────────────────────────────────────
  // Key: forwarded IP or fallback — prevents brute-force token submission
  const ip  = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local'
  const rl  = rateLimit(`activate:${ip}`, 5, 15 * 60)
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, reason: `Trop de tentatives. Réessayez dans ${rl.retryAfter}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  let licenseToken: string
  let clientHwid:   string | undefined
  try {
    const body   = await req.json()
    licenseToken = String(body.license ?? '').trim()
    clientHwid   = body.hwid ? String(body.hwid) : undefined
  } catch {
    return NextResponse.json({ ok: false, reason: 'Corps de requête invalide' }, { status: 400 })
  }

  if (!licenseToken) {
    return NextResponse.json({ ok: false, reason: 'Licence manquante' }, { status: 400 })
  }

  // ── Step 1: Cryptographic verification ─────────────────────────────────────
  const result = verifyLicenseToken(licenseToken)
  if (!result.valid || !result.payload) {
    return NextResponse.json({ ok: false, reason: result.reason })
  }

  const { payload, isAdmin } = result

  // ── Step 2: DB check (revocation, HWID binding) ─────────────────────────────
  try {
    const record = await prisma.licenseKey.findUnique({ where: { licenseId: payload.lid } })

    if (record) {
      // DB integrity check — detect SQLite tampering
      const mac = verifyRecordMac(record)
      if (mac.tampered) {
        console.error('[license/activate] DB integrity check FAILED for lid:', record.licenseId)
        return NextResponse.json({ ok: false, reason: 'Erreur d\'intégrité de la base de données. Contactez le support.' })
      }

      // Revocation check
      if (record.status === 'revoked') {
        return NextResponse.json({ ok: false, reason: 'Cette licence a été révoquée. Contactez votre revendeur.' })
      }
      if (record.status === 'suspended') {
        return NextResponse.json({ ok: false, reason: 'Cette licence est temporairement suspendue.' })
      }

      // HWID binding check (only if the stored record has a HWID)
      if (record.hwid && clientHwid) {
        if (!verifyHwid(record.hwid, clientHwid)) {
          return NextResponse.json({ ok: false, reason: 'Cette licence est liée à un autre matériel.' })
        }
      }

      // Update last-seen timestamp
      await prisma.licenseKey.update({
        where: { id: record.id },
        data:  { lastSeenAt: new Date() },
      })
    } else {
      // First use — auto-register in DB with integrity MAC
      const expiryAt  = new Date(payload.exp * 1000)
      const hwid      = payload.hwid ?? null
      const recordMac = computeRecordMac({
        licenseId: payload.lid,
        token:     licenseToken,
        status:    'active',
        expiryAt,
        hwid,
      })
      await prisma.licenseKey.create({
        data: {
          licenseId:   payload.lid,
          token:       licenseToken,
          customerId:  payload.cid,
          licenseType: payload.typ,
          expiryAt,
          status:      'active',
          isAdmin:     isAdmin ?? false,
          seats:       payload.seats ?? 1,
          hwid,
          activatedAt: new Date(),
          lastSeenAt:  new Date(),
          recordMac,
        },
      })
    }
  } catch (err) {
    // Fail-open: DB unavailable (Electron offline mode, fresh install)
    console.error('[license/activate] DB error (fail-open):', err)
  }

  // ── Step 3: Build signed session JWT ────────────────────────────────────────
  // This JWT is stored HttpOnly and verified in middleware — prevents cookie tampering.
  const sessionJwt = await new SignJWT({ typ: payload.typ, lid: payload.lid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5y')
    .sign(getSessionSecret())

  // ── Step 4: Set cookies via response headers ────────────────────────────────
  const res = NextResponse.json({
    ok:          true,
    isAdmin:     isAdmin ?? false,
    licenseType: payload.typ,
    expiryAt:    new Date(payload.exp * 1000).toISOString(),
    seats:       payload.seats ?? 1,
  })

  const base = `; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Strict`
  // Signed session token — tamper-proof (HS256 with NEXTAUTH_SECRET)
  res.headers.append('Set-Cookie', `gf_session=${sessionJwt}${base}; HttpOnly`)
  // Plain indicator cookies — used for UI state only, NOT for access control
  res.headers.append('Set-Cookie', `gf_license_validated=1${base}`)
  res.headers.append('Set-Cookie', `gf_license_type=${payload.typ}${base}`)

  return res
}
