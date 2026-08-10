/**
 * Authentification POSTE → CLOUD pour les endpoints de synchronisation.
 *
 * Le poste ne possède aucun secret partagé avec le serveur (le `.env` est retiré
 * du paquet, cf. scripts/post-build.js) : la SEULE preuve qu'il détient est sa
 * LICENCE GARAGE GF2, signée ECDSA P-256 par le keygen. C'est déjà ce que
 * /api/license/activate accepte comme preuve d'identité — on réutilise
 * exactement le même mécanisme, sans toucher au format GF2, à l'algorithme, au
 * payload, aux claims, ni au keygen.
 *
 * Contrôles appliqués (fail-closed) :
 *   1. signature ES256 valide (verifyLicenseToken) ;
 *   2. type GARAGE (jamais une clé mécanicien : elle ne pilote rien) ;
 *   3. licence CONNUE du serveur, ACTIVE, non révoquée, non expirée ;
 *   4. résolution du garage de confiance — celui rattaché à la licence.
 *
 * Le `garageId` retourné vient TOUJOURS de la base serveur (ou du rattachement
 * à la première utilisation), jamais d'un champ libre de la requête : un poste
 * ne peut donc écrire que dans SON garage.
 */
import { prisma } from '@/lib/db'
import { verifyLicenseToken, type LicensePayload } from '@/lib/license/verify'

/** Types de licence habilités à piloter un garage (identique à /license/activate). */
export const GARAGE_LICENSE_TYPES = new Set(['trial', 'premium', 'enterprise', 'admin'])

export type GarageAuthFailure =
  | 'MISSING_LICENSE'
  | 'LICENSE_INVALID'
  | 'NOT_A_GARAGE_LICENSE'
  | 'LICENSE_UNKNOWN'
  | 'LICENSE_REVOKED'
  | 'LICENSE_SUSPENDED'
  | 'LICENSE_EXPIRED'
  | 'GARAGE_MISMATCH'

export interface GarageAuthResult {
  ok: true
  payload: LicensePayload
  /** licenseId de la licence garage (parent des clés mécanicien). */
  licenseId: string
  /** Garage de confiance rattaché à cette licence (null si pas encore rattaché). */
  garageId: string | null
}

export interface GarageAuthError { ok: false; code: GarageAuthFailure }

/** Identifiant tronqué, sûr pour les journaux (jamais le jeton complet). */
export function shortId(id: string | null | undefined): string {
  const s = String(id ?? '')
  return s ? `${s.slice(0, 8)}…` : '—'
}

/**
 * Vérifie une licence GARAGE présentée par un poste.
 * `claimedGarageId` (facultatif) : le garage que le poste prétend piloter. Il
 * n'est accepté QUE si la licence n'est pas encore rattachée (première
 * utilisation) ; sinon il doit correspondre exactement.
 */
export async function authenticateGarageLicense(
  licenseToken: unknown,
  claimedGarageId?: string | null,
): Promise<GarageAuthResult | GarageAuthError> {
  const token = typeof licenseToken === 'string' ? licenseToken.trim() : ''
  if (!token) return { ok: false, code: 'MISSING_LICENSE' }

  const verified = verifyLicenseToken(token)
  if (!verified.valid || !verified.payload) return { ok: false, code: 'LICENSE_INVALID' }
  const payload = verified.payload
  if (verified.isMechanic || !GARAGE_LICENSE_TYPES.has(payload.typ)) {
    return { ok: false, code: 'NOT_A_GARAGE_LICENSE' }
  }

  const record = await prisma.licenseKey.findUnique({ where: { licenseId: payload.lid } })
  if (!record) return { ok: false, code: 'LICENSE_UNKNOWN' }
  if (record.licenseType === 'mechanic') return { ok: false, code: 'NOT_A_GARAGE_LICENSE' }
  if (record.status === 'revoked' || record.revokedAt) return { ok: false, code: 'LICENSE_REVOKED' }
  if (record.status === 'suspended') return { ok: false, code: 'LICENSE_SUSPENDED' }
  if (record.expiryAt.getTime() < Date.now()) return { ok: false, code: 'LICENSE_EXPIRED' }

  const claimed = typeof claimedGarageId === 'string' && claimedGarageId ? claimedGarageId : null
  if (record.garageId && claimed && record.garageId !== claimed) {
    return { ok: false, code: 'GARAGE_MISMATCH' }
  }

  return { ok: true, payload, licenseId: record.licenseId, garageId: record.garageId ?? null }
}
