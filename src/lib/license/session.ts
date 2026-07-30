/**
 * Session LICENCIÉE — validation serveur centralisée pour les API métier (PWA).
 *
 * Problème résolu : la session NextAuth (utilisateur + garageId) et la session
 * de licence (cookie gf_session : lid + did) étaient indépendantes ; aucune API
 * métier ne vérifiait la licence, son statut, son expiration, sa révocation, son
 * rattachement au garage, ni l'appareil. Un overlay frontend ne protège rien :
 * un appel direct à l'API passait.
 *
 * Ce module vérifie, à CHAQUE requête sensible (révocation immédiate) :
 *   1. la validité cryptographique de la session de licence (gf_session) ;
 *   2. l'existence de la licence en base ;
 *   3. son statut (active / suspended / revoked) ;
 *   4. son expiration ;
 *   5. sa révocation explicite ;
 *   6. son rattachement au garage de l'utilisateur (bind-on-first-use puis
 *      immuable — empêche l'usage d'une licence par un autre garage) ;
 *   7. l'existence de l'appareil associé (did) ;
 *   8. le statut actif de cet appareil ;
 *   9. l'appartenance de l'appareil à la licence.
 *
 * Aucune valeur envoyée par le client n'est fiable : tout est revalidé en base.
 *
 * Contexte d'application (voir licenseEnforcementEnabled) :
 *   - Electron (ELECTRON=1) : DÉSACTIVÉ — mono-poste, base locale, la licence est
 *     déjà contrôlée par la fenêtre native + le heartbeat + l'overlay ; ajouter
 *     un contrôle par requête contre la SQLite locale serait redondant.
 *   - Serveur/PWA production : TOUJOURS actif (jamais désactivable).
 *   - Dev : actif par défaut (LICENSE_ENFORCEMENT=off pour le désactiver localement).
 *   - Test : inactif par défaut (LICENSE_ENFORCEMENT=on pour l'activer).
 */

import { jwtVerify } from 'jose'
import { prisma } from '@/lib/db'
import { getAuthSecret } from '@/lib/auth-secret'

export interface LicensedContext {
  licenseId: string
  deviceId: string
  garageId: string
  licenseType: string
}

export type LicensedFailureCode =
  | 'LICENSE_SESSION_MISSING' // pas de cookie gf_session valide → réactiver
  | 'LICENSE_UNKNOWN'
  | 'LICENSE_REVOKED'
  | 'LICENSE_SUSPENDED'
  | 'LICENSE_EXPIRED'
  | 'LICENSE_GARAGE_MISMATCH' // licence rattachée à un AUTRE garage
  | 'DEVICE_REQUIRED'         // session sans appareil (ancienne) → réactiver
  | 'DEVICE_UNKNOWN'          // appareil supprimé/réinitialisé → réactiver
  | 'DEVICE_REVOKED'

export type LicensedResult =
  | { ok: true; ctx: LicensedContext }
  | { ok: false; status: number; code: LicensedFailureCode; reason: string }

const FAIL: Record<LicensedFailureCode, { status: number; reason: string }> = {
  LICENSE_SESSION_MISSING: { status: 401, reason: 'Licence requise. Activez votre licence.' },
  LICENSE_UNKNOWN:         { status: 401, reason: 'Licence introuvable. Activez votre licence.' },
  LICENSE_REVOKED:         { status: 403, reason: 'Cette licence a été révoquée.' },
  LICENSE_SUSPENDED:       { status: 403, reason: 'Cette licence est temporairement suspendue.' },
  LICENSE_EXPIRED:         { status: 403, reason: 'Cette licence a expiré.' },
  LICENSE_GARAGE_MISMATCH: { status: 403, reason: 'Cette licence est rattachée à un autre garage.' },
  DEVICE_REQUIRED:         { status: 401, reason: 'Appareil non enregistré. Réactivez votre licence.' },
  DEVICE_UNKNOWN:          { status: 401, reason: 'Appareil inconnu. Réactivez votre licence.' },
  DEVICE_REVOKED:          { status: 403, reason: 'Cet appareil a été révoqué.' },
}

function fail(code: LicensedFailureCode): LicensedResult {
  return { ok: false, code, ...FAIL[code] }
}

/**
 * Détermine si l'application des licences est active pour le contexte courant.
 * En production PWA, elle est TOUJOURS active (jamais de désactivation silencieuse).
 */
export function licenseEnforcementEnabled(): boolean {
  if (process.env.ELECTRON === '1') return false
  if (process.env.NODE_ENV === 'production') return true // prod PWA : forcé
  if (process.env.NODE_ENV === 'test') return process.env.LICENSE_ENFORCEMENT === 'on'
  return process.env.LICENSE_ENFORCEMENT !== 'off' // dev : actif par défaut
}

/** Décode et vérifie le cookie de session de licence. */
async function readGfSession(
  rawGfSession: string,
): Promise<{ lid: string; did?: string; typ: string } | null> {
  if (!rawGfSession) return null
  try {
    const secret = new TextEncoder().encode(getAuthSecret())
    const { payload } = await jwtVerify(rawGfSession, secret)
    if (typeof payload.lid !== 'string') return null
    return {
      lid: payload.lid,
      did: typeof payload.did === 'string' ? payload.did : undefined,
      typ: typeof payload.typ === 'string' ? payload.typ : 'premium',
    }
  } catch {
    return null
  }
}

/**
 * Valide la session licenciée pour un utilisateur donné (garageId) à partir du
 * cookie gf_session. Ne lève jamais — renvoie un résultat structuré.
 */
export async function validateLicensedSession(opts: {
  rawGfSession: string
  garageId: string
}): Promise<LicensedResult> {
  const session = await readGfSession(opts.rawGfSession)
  if (!session) return fail('LICENSE_SESSION_MISSING')

  const { lid, did } = session

  // 2-5. Licence : existence, statut, révocation, expiration.
  const license = await prisma.licenseKey.findUnique({ where: { licenseId: lid } })
  if (!license) return fail('LICENSE_UNKNOWN')
  if (license.status === 'revoked' || license.revokedAt) return fail('LICENSE_REVOKED')
  if (license.status === 'suspended') return fail('LICENSE_SUSPENDED')
  if (license.expiryAt.getTime() < Date.now()) return fail('LICENSE_EXPIRED')

  // 6. Rattachement au garage — bind-on-first-use (atomique), puis immuable.
  let boundGarageId = license.garageId
  if (!boundGarageId) {
    const upd = await prisma.licenseKey.updateMany({
      where: { licenseId: lid, garageId: null },
      data: { garageId: opts.garageId },
    })
    if (upd.count > 0) {
      boundGarageId = opts.garageId
    } else {
      // Une requête concurrente a rattaché la licence entre-temps : relire.
      const fresh = await prisma.licenseKey.findUnique({ where: { licenseId: lid } })
      boundGarageId = fresh?.garageId ?? null
    }
  }
  if (boundGarageId !== opts.garageId) return fail('LICENSE_GARAGE_MISMATCH')

  // 7-9. Appareil : présence du did, existence, appartenance, statut actif.
  if (!did) return fail('DEVICE_REQUIRED')
  const device = await prisma.licenseDevice.findUnique({ where: { deviceId: did } })
  if (!device || device.licenseId !== lid) return fail('DEVICE_UNKNOWN')
  if (device.status !== 'active') return fail('DEVICE_REVOKED')

  return {
    ok: true,
    ctx: { licenseId: lid, deviceId: did, garageId: opts.garageId, licenseType: session.typ },
  }
}
