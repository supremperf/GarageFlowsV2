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
import { consommerCodeSecours } from '@/lib/portal/backup-codes-store'
import { logger } from '@/lib/logger'

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

  // Le secret est stocké CHIFFRÉ (GF-DUR-022, GF-DUR-023).
  const secretTotp = lireSecretTotp(user.twoFactorSecret)
  if (!secretTotp) {
    // Un secret illisible n'est PAS un mauvais code : c'est une panne de
    // configuration — clé rotée sans `GF_TOTP_ENC_KEY_OLD`, valeur altérée. Le
    // client reçoit la même réponse qu'un code faux (aucun oracle), mais
    // l'exploitant doit pouvoir faire la différence dans ses traces, sinon il
    // cherchera longtemps une panne d'application qui n'existe pas (GF-DUR-024).
    logger.error('[portal/2fa] secret TOTP illisible — vérifiez GF_TOTP_ENC_KEY / _OLD', {
      user: user.id,
    })
  }
  const token = typeof body.token === 'string' ? body.token : undefined
  // `ok` ne vaut true que si verifyTotp (HMAC, fenêtre ±1 pas, comparaison
  // en temps constant) valide le code : aucun chemin ne dépend de la seule
  // présence de la valeur fournie par le client.
  ok = verifyTotp(token ?? '', secretTotp ?? '')

  const backupCode = typeof body.backupCode === 'string' ? body.backupCode : undefined
  if (!ok && backupCode) {
    // Retrait ATOMIQUE (GF-DUR-025). Le lire-modifier-écrire d'origine laissait
    // deux requêtes simultanées consommer le même code — et, avec deux codes
    // différents, ressusciter celui déjà utilisé. La session n'est ouverte que
    // si CETTE requête a effectivement retiré l'empreinte.
    const issue = await consommerCodeSecours(prisma, user.id, backupCode)
    if (issue.ok) {
      ok = true
      backupUsed = true
    } else if (issue.motif === 'conflit') {
      // Écritures concurrentes non départagées : on refuse plutôt que d'ouvrir
      // une session sans pouvoir prouver l'unicité de l'usage. L'utilisateur
      // retente ; le message reste celui d'un code invalide (aucun oracle).
      logger.warn('[portal/2fa] consommation de code de secours abandonnée après conflits', {
        user: user.id,
      })
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
