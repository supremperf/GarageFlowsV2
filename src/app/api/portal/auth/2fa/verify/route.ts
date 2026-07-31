export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/auth/2fa/verify — second login step for 2FA accounts.
 * Body: { challenge, token? , backupCode? }
 * Accepts a TOTP code or a one-time backup code; the backup code is consumed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { clientIp, issuePortalSession, setPortalCookie } from '@/lib/portal/auth-helpers'
import { verifyTwoFactorChallenge } from '@/lib/portal/session'
import { verifyTotp } from '@/lib/portal/totp'
import { verifyBackupCode } from '@/lib/portal/backup-codes'

export async function POST(req: NextRequest) {
  const ip = clientIp(req) ?? 'local'
  const rl = await enforceRateLimit('login', `portal-2fa:${ip}`, { max: 10, windowSec: 5 * 60 })
  if (!rl.ok) return NextResponse.json({ error: `Trop de tentatives. Réessayez dans ${rl.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })

  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }

  const userId = await verifyTwoFactorChallenge(typeof body.challenge === 'string' ? body.challenge : null)
  if (!userId) return NextResponse.json({ error: 'Challenge invalide ou expiré' }, { status: 401 })

  // Verrou PAR COMPTE (en plus du verrou par IP ci-dessus) : un attaquant qui
  // connaît le mot de passe peut faire tourner X-Forwarded-For pour contourner
  // le verrou par IP ; la clé par compte (userId) n'est pas manipulable côté
  // client et borne donc réellement le brute-force TOTP dans la fenêtre du défi.
  const rlAcct = await enforceRateLimit('login', `portal-2fa-acct:${userId}`, { max: 5, windowSec: 5 * 60 })
  if (!rlAcct.ok) return NextResponse.json({ error: `Trop de tentatives. Réessayez dans ${rlAcct.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rlAcct.retryAfterSec) } })

  const user = await prisma.portalUser.findUnique({ where: { id: userId } })
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    return NextResponse.json({ error: 'Double authentification non configurée' }, { status: 400 })
  }

  let ok = false
  let backupUsed = false

  const token = typeof body.token === 'string' ? body.token : undefined
  if (token) ok = verifyTotp(token, user.twoFactorSecret)

  const backupCode = typeof body.backupCode === 'string' ? body.backupCode : undefined
  if (!ok && backupCode) {
    const hashes = safeParseHashes(user.backupCodes)
    const idx = verifyBackupCode(backupCode, hashes)
    if (idx >= 0) {
      ok = true
      backupUsed = true
      hashes.splice(idx, 1) // consume — one-time use
      await prisma.portalUser.update({ where: { id: user.id }, data: { backupCodes: JSON.stringify(hashes) } })
    }
  }

  if (!ok) return NextResponse.json({ error: 'Code invalide' }, { status: 401 })

  const { token: sessionToken } = await issuePortalSession(user.id, req)
  const res = NextResponse.json({ ok: true, backupCodeUsed: backupUsed, user: { id: user.id, email: user.email, name: user.name } })
  setPortalCookie(res, sessionToken)
  return res
}

function safeParseHashes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : []
  } catch {
    return []
  }
}
