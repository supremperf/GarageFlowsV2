import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { headers, cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { getSessionSecret } from '@/lib/session-secret'

// ─── In-memory rate limiter ────────────────────────────────────────────────
// Buckets: { key -> { count, resetAt } }
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

/**
 * Simple token-bucket rate limiter.
 * @param key   Unique key (e.g. "ip:127.0.0.1")
 * @param max   Max requests per window
 * @param windowMs  Window in milliseconds
 * @returns true if the request is allowed, false if rate limited
 */
function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const bucket = rateLimitStore.get(key)
  if (!bucket || now > bucket.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (bucket.count >= max) return false
  bucket.count++
  return true
}

function getClientIp(req: Request): string {
  const headersList = headers()
  return (
    headersList.get('x-forwarded-for')?.split(',')[0].trim() ||
    headersList.get('x-real-ip') ||
    'unknown'
  )
}

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
      // General API rate limit: 120 requests/minute per IP
      const ip = getClientIp(req)
      if (!checkRateLimit(`api:${ip}`, 120, 60_000)) {
        return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 })
      }
      return await handler(req, ctx)
    } catch (e) {
      if (e instanceof NextResponse) return e
      // Log the full error server-side only; NEVER echo the raw message to the
      // client (it can carry Prisma/schema/constraint details, file paths, or
      // upstream provider errors — reconnaissance aid).
      console.error('[API Error]', e)
      return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
    }
  }
}

/** Rate limit for auth endpoints: 10 attempts per 5 minutes per IP */
export function withLoginRateLimit(
  handler: (req: Request, ctx?: any) => Promise<NextResponse>
) {
  return async (req: Request, ctx?: any): Promise<NextResponse> => {
    try {
      const ip = getClientIp(req)
      if (!checkRateLimit(`login:${ip}`, 10, 5 * 60_000)) {
        return NextResponse.json(
          { error: 'Trop de tentatives de connexion. Réessayez dans 5 minutes.' },
          { status: 429 }
        )
      }
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
    // Fails closed: getSessionSecret() throws if NEXTAUTH_SECRET is unset or a
    // known committed default, so a misconfigured deploy can never be spoofed
    // into accepting an admin cookie signed with a public key.
    const { payload } = await jwtVerify(raw, getSessionSecret())
    return payload.typ === 'admin'
  } catch {
    return false
  }
}
