import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { getToken } from 'next-auth/jwt'

/**
 * GarageFlow middleware — page-level only (all /api/* are skipped)
 * Order of checks:
 *  1. Skip static assets and ALL /api/ routes (APIs handle auth themselves)
 *  2. Admin pages (/admin/*) → require a valid signed gf_session JWT with typ=admin
 *  3. License check — if no valid gf_session JWT → /license
 *  4. Auth check  — if not authenticated on protected page → /login
 *  5. Redirect authenticated user away from /login and /register → /
 */

function getJwtSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET ?? 'gf-electron-local-secret-2026-xK9mP3qR'
  return new TextEncoder().encode(secret)
}

/** Verify the signed gf_session cookie. Returns payload or null on failure. */
async function verifySessionJwt(req: NextRequest): Promise<{ typ: string; lid: string } | null> {
  const raw = req.cookies.get('gf_session')?.value
  if (!raw) return null
  try {
    const { payload } = await jwtVerify(raw, getJwtSecret())
    if (typeof payload.typ !== 'string' || typeof payload.lid !== 'string') return null
    return { typ: payload.typ, lid: payload.lid }
  } catch {
    return null
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── 1. Skip public assets, API routes and customer-facing portal ─────────
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/portal') ||   // public customer portal — no gf_session needed
    pathname === '/favicon.ico' ||
    pathname.startsWith('/public/')
  ) {
    return NextResponse.next()
  }

  // ── 2. Admin routes — require signed JWT with typ=admin ───────────────────
  if (pathname.startsWith('/admin')) {
    const session = await verifySessionJwt(req)
    if (session?.typ !== 'admin') {
      return NextResponse.redirect(new URL('/license', req.url))
    }
    return NextResponse.next()
  }

  // ── 3. License check ─────────────────────────────────────────────────────
  const session = await verifySessionJwt(req)

  if (pathname === '/license') {
    if (session) {
      return NextResponse.redirect(
        new URL(session.typ === 'admin' ? '/admin/licenses' : '/login', req.url)
      )
    }
    return NextResponse.next()
  }

  if (!session) {
    return NextResponse.redirect(new URL('/license', req.url))
  }

  // ── 4. Auth check ─────────────────────────────────────────────────────────
  const isAuthPage = pathname === '/login' || pathname === '/register'
  // getToken() can throw on a malformed Authorization/Bearer header — treat any
  // failure as "not authenticated" instead of letting the middleware 500 (DoS).
  let token: Awaited<ReturnType<typeof getToken>> = null
  try {
    token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  } catch {
    token = null
  }

  if (!token && !isAuthPage) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // ── 5. Already authenticated — redirect away from auth pages ──────────────
  if (token && isAuthPage) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
