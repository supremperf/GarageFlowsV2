import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { getAuthSecret } from '@/lib/auth-secret'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { logger } from '@/lib/logger'
import { licenseEnforcementEnabled, validateLicensedSession } from '@/lib/license/session'

// Rate limiting : implémentation UNIQUE dans src/lib/security/rate-limit.ts
// (distribuée en production PWA, mémoire uniquement pour Electron/dev/test).
// L'ancienne Map locale de ce fichier a été supprimée.

/**
 * Point de contrôle UNIQUE des API métier : renvoie la session utilisateur
 * authentifiée OU lève une réponse d'erreur (capturée par withAuth).
 *
 * En contexte serveur/PWA (voir licenseEnforcementEnabled), cette fonction
 * applique EN PLUS la validation de la session licenciée (licence active/non
 * expirée/non révoquée, rattachement au garage, appareil actif) — révocation
 * immédiate, aucune valeur client fiable. Toutes les routes métier passent par
 * ici (les routes pré-licence comme l'inscription NE l'appellent pas), donc la
 * protection s'applique partout d'un seul point. Sur Electron, seule la session
 * est vérifiée (la licence est déjà contrôlée localement — exception documentée).
 */
export async function requireSession() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.garageId) {
    throw NextResponse.json({ error: 'Non autorisé', code: 'UNAUTHENTICATED' }, { status: 401 })
  }

  if (licenseEnforcementEnabled()) {
    const raw = cookies().get('gf_session')?.value ?? ''
    const check = await validateLicensedSession({ rawGfSession: raw, garageId: session.user.garageId })
    if (!check.ok) {
      throw NextResponse.json({ error: check.reason, code: check.code }, { status: check.status })
    }
  }

  return session
}

/** Wraps an async route handler and catches thrown NextResponse.
 *  Applies rate limiting: 120 req/min per authenticated user (by garageId). */
export function withAuth(
  handler: (req: Request, ctx?: any) => Promise<NextResponse>
) {
  return async (req: Request, ctx?: any): Promise<NextResponse> => {
    try {
      // General API rate limit (défaut 120 req/min/IP — RATE_LIMIT_API_*)
      const rl = await enforceRateLimit('api', clientIpFrom(req))
      if (!rl.ok) return rateLimitResponse(rl)
      return await handler(req, ctx)
    } catch (e) {
      if (e instanceof NextResponse) return e
      // Les détails techniques (message Prisma, chemins, contraintes) vont dans
      // les logs serveur REDACTÉS — JAMAIS dans la réponse publique.
      logger.error('[API Error]', e)
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.', code: 'INTERNAL_ERROR' },
        { status: 500 },
      )
    }
  }
}

/** Max base64 logo size (after client-side downscale). Generous headroom: ~4 MB. */
export const MAX_LOGO_BASE64_LENGTH = 4 * 1024 * 1024

/** Max base64 photo size (job/inspection photos, after client-side downscale). ~8 MB. */
export const MAX_PHOTO_BASE64_LENGTH = 8 * 1024 * 1024

/** Types d'image autorisés pour un upload (data-URL). */
export const ALLOWED_IMAGE_MIME = /^image\/(jpe?g|png|webp|gif)$/i

/**
 * Verify the signed gf_session JWT and return true if the session has typ=admin.
 * Reads the HttpOnly gf_session cookie — never trusts the plain gf_license_type cookie.
 */
export async function isAdminSession(): Promise<boolean> {
  const raw = cookies().get('gf_session')?.value
  if (!raw) return false
  try {
    // No hard-coded fallback — a forgeable admin secret = full /api/admin/* takeover.
    const secret = new TextEncoder().encode(getAuthSecret())
    const { payload } = await jwtVerify(raw, secret)
    return payload.typ === 'admin'
  } catch {
    return false
  }
}
