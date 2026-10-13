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
  | 'LICENSE_WRONG_TYPE'      // clé MECHANIC utilisée comme licence Garage
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
  LICENSE_WRONG_TYPE:      { status: 403, reason: 'Cette clé est réservée à l\'espace mécanicien.' },
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
 * Identifiant de la licence sous laquelle CETTE installation tourne réellement
 * (claim `lid` du cookie `gf_session`, JWT signé HS256 posé par
 * `/api/license/activate`), ou `null` si aucune session licenciée n'est présente
 * ou si le jeton est invalide.
 *
 * C'est la seule preuve serveur qu'un appelant détient une licence GARAGE
 * donnée — la possession d'un jeton de clé MÉCANICIEN n'en est pas une : le
 * `plid` signé prouve à quelle licence garage la clé appartient, pas que celui
 * qui la présente a le droit d'en disposer (GF31-AUD-007).
 *
 * Ne lève jamais. Renvoie `null` pour une session de type mécanicien : elle ne
 * licencie pas l'application garage.
 */
export async function activeGarageLicenseId(rawGfSession: string): Promise<string | null> {
  const session = await readGfSession(rawGfSession)
  if (!session || session.typ === 'mechanic') return null
  return session.lid
}

/**
 * RATTACHEMENT au garage — bind-on-first-use atomique, puis immuable.
 *
 * Rend le garage auquel la licence est RÉELLEMENT rattachée après l'opération :
 * celui déjà en base s'il existe, sinon `candidat` si le rattachement a réussi,
 * sinon celui qu'une requête concurrente a posé entre-temps. L'appelant compare
 * lui-même au garage attendu — cette fonction ne refuse rien, elle constate.
 *
 * Le `updateMany ... where garageId: null` est la garde de concurrence : deux
 * requêtes simultanées ne peuvent pas rattacher la même licence à deux garages.
 */
async function bindGarageOnFirstUse(
  licenseId: string,
  garageIdEnBase: string | null,
  candidat: string,
): Promise<string | null> {
  if (garageIdEnBase) return garageIdEnBase
  const upd = await prisma.licenseKey.updateMany({
    where: { licenseId, garageId: null },
    data: { garageId: candidat },
  })
  if (upd.count > 0) return candidat
  // Une requête concurrente a rattaché la licence entre-temps : relire.
  const fresh = await prisma.licenseKey.findUnique({ where: { licenseId } })
  return fresh?.garageId ?? null
}

/**
 * RATTACHEMENT SEUL, sans le moindre contrôle d'accès — pour le poste Electron.
 *
 * LE DÉFAUT QU'ELLE CORRIGE (mesuré le 2026-08-16 sur un poste fraîchement
 * installé). `licenseEnforcementEnabled()` rend `false` sous Electron, et à bon
 * droit : la licence y est déjà contrôlée par la fenêtre native, le heartbeat et
 * l'overlay. Mais le rattachement au garage ne vivait QUE dans
 * `validateLicensedSession`, c'est-à-dire dans le chemin désactivé. Conséquence :
 * sur un poste packagé, `LicenseKey.garageId` restait `null` POUR TOUJOURS.
 *
 * Or `garageLicenseToken()` (src/lib/sync/cloud-client.ts) cherche la licence
 * PAR garageId : elle ne trouvait rien, `syncGarageJobs` sortait aussitôt en
 * `NO_GARAGE_LICENSE`, et la remontée vers l'espace mécanicien ne partait
 * jamais — l'écran du comptoir affichant « Synchronisation cloud en attente »
 * indéfiniment, sans une ligne de journal pour l'expliquer.
 *
 * Ce que cette fonction fait, et surtout ce qu'elle NE fait PAS : elle rattache,
 * point. Elle ne refuse aucune requête, ne lève jamais, et ne réintroduit aucun
 * contrôle par requête sous Electron. Le `lid` vient du cookie `gf_session`
 * SIGNÉ (HS256) et le garage de la session authentifiée : les deux sont de
 * confiance. Une session mécanicien est ignorée — une clé mécanicien ne
 * licencie pas le garage et ne doit jamais être rattachée par cette voie.
 */
export async function attachLicenseToGarage(opts: {
  rawGfSession: string
  garageId: string
}): Promise<void> {
  try {
    const session = await readGfSession(opts.rawGfSession)
    if (!session || session.typ === 'mechanic' || !opts.garageId) return

    const license = await prisma.licenseKey.findUnique({ where: { licenseId: session.lid } })
    // Déjà rattachée (au bon garage ou à un autre) : immuable, on ne touche à
    // rien. Le type en BASE fait foi, comme partout ailleurs dans ce module.
    if (!license || license.garageId || license.licenseType === 'mechanic') return

    await bindGarageOnFirstUse(session.lid, null, opts.garageId)
  } catch {
    // Best-effort STRICT : un poste hors ligne, une base verrouillée ou une
    // migration en cours ne doivent jamais empêcher l'application de servir.
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

  // Une session MECHANIC ne licencie JAMAIS l'application garage : les API
  // métier (clients, factures, paramètres…) exigent une licence Garage.
  if (session.typ === 'mechanic') return fail('LICENSE_WRONG_TYPE')

  const { lid, did } = session

  // 2-5. Licence : existence, statut, révocation, expiration.
  const license = await prisma.licenseKey.findUnique({ where: { licenseId: lid } })
  if (!license) return fail('LICENSE_UNKNOWN')
  // Défense en profondeur : même si le cookie prétend un autre type, le type
  // en BASE fait foi — une clé mécanicien ne passe jamais côté garage.
  if (license.licenseType === 'mechanic') return fail('LICENSE_WRONG_TYPE')
  if (license.status === 'revoked' || license.revokedAt) return fail('LICENSE_REVOKED')
  if (license.status === 'suspended') return fail('LICENSE_SUSPENDED')
  if (license.expiryAt.getTime() < Date.now()) return fail('LICENSE_EXPIRED')

  // 6. Rattachement au garage — bind-on-first-use (atomique), puis immuable.
  const boundGarageId = await bindGarageOnFirstUse(lid, license.garageId, opts.garageId)
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
