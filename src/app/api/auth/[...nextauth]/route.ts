import { NextRequest, NextResponse } from 'next/server'
import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

const handler = NextAuth(authOptions)

// GET: session fetch, CSRF token — no rate limit needed
export { handler as GET }

// POST: credentials sign-in — rate-limit to 10 attempts per IP per 15 min
export async function POST(req: NextRequest, ctx: { params: { nextauth: string[] } }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local'
  const rl = rateLimit(`auth:${ip}`, 10, 15 * 60)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Trop de tentatives. Réessayez dans ${rl.retryAfter}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }
  return handler(req, ctx)
}
