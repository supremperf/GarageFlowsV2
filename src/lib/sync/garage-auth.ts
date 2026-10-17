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
import { isDatabaseUnavailableError } from '@/lib/errors/apiErrors'

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
  /** Le garage revendiqué appartient DÉJÀ à une autre licence garage. */
  | 'GARAGE_ALREADY_CLAIMED'
  /** La licence n'est pas encore rattachée : opération réservée aux licences liées. */
  | 'LICENSE_NOT_BOUND'
  | 'DB_UNAVAILABLE'
  | 'SERVER_MISCONFIGURED'

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

/** Types de licence qui RÉSERVENT un garage (tout sauf les clés mécanicien). */
const GARAGE_OWNING_TYPES = { not: 'mechanic' } as const

/**
 * Un garage est-il DÉJÀ réservé par une autre licence garage que celle donnée ?
 *
 * C'est le verrou qui rend le rattachement à la première utilisation sûr : sans
 * lui, toute licence garage encore NON rattachée pouvait revendiquer
 * l'identifiant d'un garage existant et s'y lier définitivement (GF31-AUD-003).
 * Exposé pour être rejoué À L'INTÉRIEUR de la transaction qui rattache.
 */
export interface LicenseKeyReader {
  licenseKey: {
    // Syntaxe de MÉTHODE (et non propriété-flèche) : la bivariance des
    // paramètres qu'elle autorise rend `PrismaClient` comme le client de
    // transaction assignables à ce contrat minimal, sans `any` ni cast.
    findFirst(args: {
      where: Record<string, unknown>
      select: { licenseId: true }
    }): Promise<{ licenseId: string } | null>
  }
}

export async function isGarageClaimedByAnotherLicense(
  db: LicenseKeyReader,
  garageId: string,
  ownLicenseId: string,
): Promise<boolean> {
  const other = await db.licenseKey.findFirst({
    where: {
      garageId,
      licenseType: GARAGE_OWNING_TYPES,
      NOT: { licenseId: ownLicenseId },
    },
    select: { licenseId: true },
  })
  return other !== null
}

/**
 * Vérifie une licence GARAGE présentée par un poste.
 *
 * `claimedGarageId` (facultatif) : le garage que le poste prétend piloter.
 *   - licence DÉJÀ rattachée → le garage revendiqué doit correspondre EXACTEMENT ;
 *   - licence NON rattachée → la revendication n'est retenue que si ce garage
 *     n'est réservé par AUCUNE autre licence garage (sinon `GARAGE_ALREADY_CLAIMED`).
 *
 * `opts.requireBound` : refuse toute licence encore non rattachée. À utiliser sur
 * les routes qui ne créent PAS le miroir du garage (jobs, photos) : elles n'ont
 * aucune raison légitime d'être le tout premier contact d'un poste, et sans cela
 * une licence non rattachée pouvait lire, écrire et SUPPRIMER dans un garage
 * qu'aucune licence ne réservait encore (garage créé côté PWA, par exemple).
 */
export async function authenticateGarageLicense(
  licenseToken: unknown,
  claimedGarageId?: string | null,
  opts?: { requireBound?: boolean },
): Promise<GarageAuthResult | GarageAuthError> {
  const token = typeof licenseToken === 'string' ? licenseToken.trim() : ''
  if (!token) return { ok: false, code: 'MISSING_LICENSE' }

  const verified = verifyLicenseToken(token)
  if (verified.failure === 'misconfigured') return { ok: false, code: 'SERVER_MISCONFIGURED' }
  if (!verified.valid || !verified.payload) return { ok: false, code: 'LICENSE_INVALID' }
  const payload = verified.payload
  if (verified.isMechanic || !GARAGE_LICENSE_TYPES.has(payload.typ)) {
    return { ok: false, code: 'NOT_A_GARAGE_LICENSE' }
  }

  let record
  try {
    record = await prisma.licenseKey.findUnique({ where: { licenseId: payload.lid } })
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return { ok: false, code: 'DB_UNAVAILABLE' }
    throw error
  }
  if (!record) return { ok: false, code: 'LICENSE_UNKNOWN' }
  if (record.licenseType === 'mechanic') return { ok: false, code: 'NOT_A_GARAGE_LICENSE' }
  if (record.status === 'revoked' || record.revokedAt) return { ok: false, code: 'LICENSE_REVOKED' }
  if (record.status === 'suspended') return { ok: false, code: 'LICENSE_SUSPENDED' }
  if (record.expiryAt.getTime() < Date.now()) return { ok: false, code: 'LICENSE_EXPIRED' }

  const claimed = typeof claimedGarageId === 'string' && claimedGarageId ? claimedGarageId : null
  if (record.garageId && claimed && record.garageId !== claimed) {
    return { ok: false, code: 'GARAGE_MISMATCH' }
  }

  if (!record.garageId) {
    // Licence encore NON rattachée.
    if (opts?.requireBound) return { ok: false, code: 'LICENSE_NOT_BOUND' }
    // La revendication ne vaut que si personne ne détient déjà ce garage.
    if (claimed) {
      try {
        if (await isGarageClaimedByAnotherLicense(prisma, claimed, record.licenseId)) {
          return { ok: false, code: 'GARAGE_ALREADY_CLAIMED' }
        }
      } catch (error) {
        if (isDatabaseUnavailableError(error)) return { ok: false, code: 'DB_UNAVAILABLE' }
        throw error
      }
    }
  }

  return { ok: true, payload, licenseId: record.licenseId, garageId: record.garageId ?? null }
}
