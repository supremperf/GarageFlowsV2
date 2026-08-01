export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/verify-email/confirm  (public)
 * Body: { token }
 * Consomme un jeton de vérification d'e-mail (usage unique) et marque le compte
 * comme e-mail vérifié.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { clientIp } from '@/lib/portal/auth-helpers'
import { confirmEmailVerification } from '@/lib/users/service'

const Body = z.object({ token: z.string().min(10).max(200) })

export async function POST(req: NextRequest) {
  const ip = clientIp(req) ?? 'local'
  const rl = await enforceRateLimit('login', `verify-email:${ip}`, { max: 10, windowSec: 15 * 60 })
  if (!rl.ok) {
    return NextResponse.json({ error: `Trop de tentatives. Réessayez dans ${rl.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Données invalides' }, { status: 400 })

  const res = await confirmEmailVerification(parsed.data.token)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
