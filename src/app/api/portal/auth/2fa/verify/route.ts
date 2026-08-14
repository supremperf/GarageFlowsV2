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
import { lireSecretTotp } from '@/lib/portal/totp-storage'
import { verifyBackupCode } from '@/lib/portal/backup-codes'

export async function POST(req: NextRequest) {
  const ip = clientIp(req) ?? 'local'
  const rl = await enforceRateLimit('login', `portal-2fa:${ip}`, { max: 10, windowSec: 5 * 60 })
  if (!rl.ok) return NextResponse.json({ error: `Trop de tentatives. Réessayez dans ${rl.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })

  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }

  const userId = await verifyTwoFactorChallenge(typeof body.challenge === 'string' ? body.challenge : null)
  if (!userId) return NextResponse.json({ error: 'Challenge invalide ou expiré' }, { status: 401 })

  const user = await prisma.portalUser.findUnique({ where: { id: userId } })
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    return NextResponse.json({ error: 'Double authentification non configurée' }, { status: 400 })
  }

  let ok = false
  let backupUsed = false

  // Le secret est stocké CHIFFRÉ (GF-DUR-022) ; `lireSecretTotp` rend aussi les
  // valeurs héritées en clair, pour ne verrouiller aucun compte déjà enrôlé.
  const secretTotp = lireSecretTotp(user.twoFactorSecret)
  const token = typeof body.token === 'string' ? body.token : undefined
  if (token && secretTotp) ok = verifyTotp(token, secretTotp)

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
  // Même information qu'à la connexion simple : sans elle, un compte à mot de
  // passe provisoire ET double facteur passerait par une page vide.
  const res = NextResponse.json({
    ok: true,
    backupCodeUsed: backupUsed,
    mustChangePassword: user.mustChangePassword,
    user: { id: user.id, email: user.email, name: user.name },
  })
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
