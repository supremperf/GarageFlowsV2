import { NextRequest } from 'next/server'
import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { logger } from '@/lib/logger'

// AUTH_STEP_0 : la route NextAuth est chargée (module évalué une seule fois).
logger.info('AUTH', { step: 'AUTH_STEP_0_ROUTE_LOADED', result: 'ok' })

const handler = NextAuth(authOptions)

// GET: session fetch, CSRF token — no rate limit needed
export { handler as GET }

// POST: credentials sign-in — limité par IP (défaut 10 / 15 min, RATE_LIMIT_LOGIN_*)
export async function POST(req: NextRequest, ctx: { params: { nextauth: string[] } }) {
  const rl = await enforceRateLimit('login', clientIpFrom(req))
  if (!rl.ok) {
    // OBSERVABILITÉ (mission §4.3) : rendre visible la cause d'un 503 « sans
    // appel externe » (~14 ms). Le limiteur est fail-closed : en production PWA,
    // un backend distribué (Upstash) est requis mais indisponible — la requête
    // est refusée AVANT toute vérification NextAuth/BD, d'où l'absence de trafic
    // sortant. Ce log transforme une erreur silencieuse en événement diagnostiqué.
    if (rl.degraded === 'fail_closed') {
      logger.error('AUTH', {
        step: 'AUTH_STEP_3_RATE_LIMIT',
        result: 'fail_closed_503',
        reason: 'distributed_rate_limit_backend_unavailable',
      })
    } else {
      logger.warn('AUTH', { step: 'AUTH_STEP_3_RATE_LIMIT', result: 'rate_limited_429' })
    }
    return rateLimitResponse(rl)
  }
  return handler(req, ctx)
}
