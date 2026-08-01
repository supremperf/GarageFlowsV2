export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/password-reset/confirm  (public)
 * Body: { token, password }
 * Consomme un jeton de réinitialisation (usage unique, haché) et fixe le nouveau
 * mot de passe ; toutes les sessions existantes du compte sont révoquées.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { clientIp } from '@/lib/portal/auth-helpers'
import { confirmPasswordReset } from '@/lib/users/service'

const Body = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8, 'Minimum 8 caractères').max(128),
})

export async function POST(req: NextRequest) {
  const ip = clientIp(req) ?? 'local'
  const rl = await enforceRateLimit('login', `pwreset-confirm:${ip}`, { max: 10, windowSec: 15 * 60 })
  if (!rl.ok) {
    return NextResponse.json({ error: `Trop de tentatives. Réessayez dans ${rl.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  const res = await confirmPasswordReset(parsed.data.token, parsed.data.password)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
