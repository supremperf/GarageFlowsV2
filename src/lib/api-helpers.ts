import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { getAuthSecret } from '@/lib/auth-secret'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { logger } from '@/lib/logger'
import { licenseEnforcementEnabled, validateLicensedSession } from '@/lib/license/session'
import { prisma } from '@/lib/db'

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
 * Décision PURE (testable) : une licence admin lue en base est-elle EXPLOITABLE ?
 * Une licence admin révoquée / suspendue / expirée ne l'est plus. Le type en base
 * fait foi (défense en profondeur : un cookie ne peut pas se prétendre admin si la
 * licence sous-jacente ne l'est pas).
 */
export function adminLicenseAcceptable(
  license:
    | { licenseType?: string | null; isAdmin?: boolean | null; status?: string | null; revokedAt?: Date | null; expiryAt?: Date | null }
    | null,
  now: number = Date.now(),
): boolean {
  if (!license) return false
  const isAdminLicense = license.isAdmin === true || license.licenseType === 'admin'
  if (!isAdminLicense) return false
  if (license.status === 'revoked' || license.revokedAt) return false
  if (license.status === 'suspended') return false
  if (license.expiryAt && license.expiryAt.getTime() < now) return false
  return true
}

/**
 * Verify the signed gf_session JWT AND re-validate the admin license IN THE
 * DATABASE on every call. Reads the HttpOnly gf_session cookie — never trusts the
 * plain gf_license_type cookie.
 *
 * Pourquoi le contrôle en base : les routes /api/admin/* ne dépendaient QUE de la
 * signature + du champ typ du cookie. Une licence admin RÉVOQUÉE (PATCH
 * /api/admin/licenses/[id] status='revoked', /revoke-by-key) laissait donc l'accès
 * admin ouvert jusqu'à l'expiration du cookie signé (30 j PWA, 5 ans Electron) —
 * la révocation, contrôle de coupure prévu, était inopérante. On revalide
 * désormais existence + statut + révocation + expiration à CHAQUE requête, comme
 * validateLicensedSession le fait pour les licences Garage. Fail-closed : cookie
 * invalide OU base indisponible → refus (jamais d'ouverture d'accès admin par défaut).
 */
export async function isAdminSession(): Promise<boolean> {
  const raw = cookies().get('gf_session')?.value
  if (!raw) return false
  try {
    // No hard-coded fallback — a forgeable admin secret = full /api/admin/* takeover.
    const secret = new TextEncoder().encode(getAuthSecret())
    const { payload } = await jwtVerify(raw, secret)
    if (payload.typ !== 'admin' || typeof payload.lid !== 'string') return false
    const license = await prisma.licenseKey.findUnique({ where: { licenseId: payload.lid } })
    return adminLicenseAcceptable(license)
  } catch {
    return false
  }
}
