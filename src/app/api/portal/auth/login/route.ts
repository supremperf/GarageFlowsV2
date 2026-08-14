export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/auth/login — password step.
 * Body: { email, password, garageSlug? }
 * Enforces brute-force lockout and gates 2FA: when the account has 2FA enabled a
 * short-lived challenge is returned instead of a session, to be completed at
 * /api/portal/auth/2fa/verify.
 */

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { resolveGarageId, clientIp, issuePortalSession, setPortalCookie } from '@/lib/portal/auth-helpers'
import {
  isLocked, lockRemainingSec, registerFailure, DEFAULT_LOCKOUT_POLICY, type LockoutState,
} from '@/lib/portal/lockout'
import { signTwoFactorChallenge } from '@/lib/portal/session'

// Valid-format hash used for a constant-time compare when the account is unknown
// (defends against user enumeration via response timing).
const DUMMY_HASH = bcrypt.hashSync('portal-enumeration-guard', 10)

const GENERIC_401 = { error: 'Email ou mot de passe incorrect' }

export async function POST(req: NextRequest) {
  const ip = clientIp(req) ?? 'local'
  const rl = await enforceRateLimit('login', `portal-login:${ip}`, { max: 10, windowSec: 5 * 60 })
  if (!rl.ok) {
    return NextResponse.json({ error: `Trop de tentatives. Réessayez dans ${rl.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  }

  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }

  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const garageId = await resolveGarageId(typeof body.garageSlug === 'string' ? body.garageSlug : null)
  if (!garageId) return NextResponse.json({ error: 'Garage introuvable ou ambigu (garageSlug requis)' }, { status: 400 })

  const user = await prisma.portalUser.findUnique({ where: { garageId_email: { garageId, email } } })
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH) // equalise timing
    return NextResponse.json(GENERIC_401, { status: 401 })
  }

  const state: LockoutState = { failedCount: user.failedLoginCount, lockedUntil: user.lockedUntil?.getTime() ?? null }
  if (isLocked(state)) {
    const retryAfter = lockRemainingSec(state)
    return NextResponse.json({ error: 'Compte temporairement verrouillé (trop de tentatives).', retryAfter }, { status: 429, headers: { 'Retry-After': String(retryAfter) } })
  }

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) {
    const next = registerFailure(state, DEFAULT_LOCKOUT_POLICY)
    await prisma.portalUser.update({
      where: { id: user.id },
      data: { failedLoginCount: next.failedCount, lockedUntil: next.lockedUntil ? new Date(next.lockedUntil) : null },
    })
    const locked = next.lockedUntil != null
    return NextResponse.json(locked ? { error: 'Compte verrouillé suite à trop de tentatives.' } : GENERIC_401, { status: locked ? 429 : 401 })
  }

  // Success — clear lockout counters.
  await prisma.portalUser.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  })

  if (user.twoFactorEnabled) {
    const challenge = await signTwoFactorChallenge(user.id)
    return NextResponse.json({ requires2fa: true, challenge })
  }

  const { token } = await issuePortalSession(user.id, req)
  // `mustChangePassword` est rendu pour que l'écran de connexion envoie
  // DIRECTEMENT vers la définition du mot de passe. Sans lui, le client passait
  // par son espace, y recevait un 403 sur chaque route, et n'était réorienté
  // qu'ensuite — après un aller-retour qui ressemble à une panne. L'information
  // ne concerne que le compte qui vient de s'authentifier.
  const res = NextResponse.json({
    ok: true,
    mustChangePassword: user.mustChangePassword,
    user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified },
  })
  setPortalCookie(res, token)
  return res
}
