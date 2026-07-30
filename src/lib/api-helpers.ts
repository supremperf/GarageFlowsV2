import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { getAuthSecret } from '@/lib/auth-secret'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'

// Rate limiting : implémentation UNIQUE dans src/lib/security/rate-limit.ts
// (distribuée en production PWA, mémoire uniquement pour Electron/dev/test).
// L'ancienne Map locale de ce fichier a été supprimée.

/** Returns the current session or throws a 401 JSON response */
export async function requireSession() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.garageId) {
    throw NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }
  return session
}

/** Wraps an async route handler and catches thrown NextResponse.
 *  Applies rate limiting: 120 req/min per authenticated user (by garageId). */
export function withAuth(
  handler: (req: Request, ctx?: any) => Promise<NextResponse>
) {
  return async (req: Request, ctx?: any): Promise<NextResponse> => {
    try {
      // General API rate limit (défaut 120 req/min/IP — RATE_LIMIT_API_*)
      const rl = await enforceRateLimit('api', clientIpFrom(req))
      if (!rl.ok) return rateLimitResponse(rl)
      return await handler(req, ctx)
    } catch (e) {
      if (e instanceof NextResponse) return e
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[API Error]', msg)
      return NextResponse.json({ error: `Erreur interne: ${msg}` }, { status: 500 })
    }
  }
}

/** Rate limit for auth endpoints: 10 attempts per 5 minutes per IP */
export function withLoginRateLimit(
  handler: (req: Request, ctx?: any) => Promise<NextResponse>
) {
  return async (req: Request, ctx?: any): Promise<NextResponse> => {
    try {
      // Connexion (défaut 10 tentatives / 15 min / IP — RATE_LIMIT_LOGIN_*)
      const rl = await enforceRateLimit('login', clientIpFrom(req))
      if (!rl.ok) return rateLimitResponse(rl)
      return await handler(req, ctx)
    } catch (e) {
      if (e instanceof NextResponse) return e
      console.error('[Auth Error]', e)
      return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
    }
  }
}

/** Max base64 logo size (after client-side downscale). Generous headroom: ~4 MB. */
export const MAX_LOGO_BASE64_LENGTH = 4 * 1024 * 1024

/**
 * Verify the signed gf_session JWT and return true if the session has typ=admin.
 * Reads the HttpOnly gf_session cookie — never trusts the plain gf_license_type cookie.
 */
export async function isAdminSession(): Promise<boolean> {
  const raw = cookies().get('gf_session')?.value
  if (!raw) return false
  try {
    // No hard-coded fallback — a forgeable admin secret = full /api/admin/* takeover.
    const secret = new TextEncoder().encode(getAuthSecret())
    const { payload } = await jwtVerify(raw, secret)
    return payload.typ === 'admin'
  } catch {
    return false
  }
}
