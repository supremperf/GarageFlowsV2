import { NextRequest } from 'next/server'
import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'

const handler = NextAuth(authOptions)

// GET: session fetch, CSRF token — no rate limit needed
export { handler as GET }

// POST: credentials sign-in — limité par IP (défaut 10 / 15 min, RATE_LIMIT_LOGIN_*)
export async function POST(req: NextRequest, ctx: { params: { nextauth: string[] } }) {
  const rl = await enforceRateLimit('login', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)
  return handler(req, ctx)
}
