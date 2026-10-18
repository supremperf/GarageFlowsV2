/**
 * Helpers d'administration des clés MÉCANICIEN côté propriétaire du garage.
 *
 * Ces fonctions garantissent que :
 *  - le recordMac (intégrité DB) est recalculé à chaque changement de statut ou
 *    d'attribution (sinon un MAC périmé ferait échouer les vérifications) ;
 *  - une réattribution ou une révocation/suspension DÉSACTIVE immédiatement tous
 *    les appareils de la clé (les sessions mécanicien deviennent invalides au
 *    prochain contrôle serveur).
 */

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { computeRecordMac } from '@/lib/license/record-mac'

/** Erreur de configuration serveur (GF_MAX_MECHANIC_KEYS invalide). */
export class MechanicConfigError extends Error {}

/** Erreur métier : plafond de clés mécanicien atteint pour le garage. */
export class MechanicKeyCapError extends Error {
  constructor(public readonly max: number) {
    super(`Nombre maximal de clés mécanicien atteint (${max}).`)
  }
}

// GF_MAX_MECHANIC_KEYS : entier STRICTEMENT positif. Zod rejette NaN (échoue
// .int()), 0 et négatif (.positive()), et non-entier (.int()).
const MAX_KEYS_SCHEMA = z.coerce.number().int().positive()
const DEFAULT_MAX_MECHANIC_KEYS = 20

/**
 * Plafond de clés mécanicien par garage, validé STRICTEMENT.
 * Absent/vide ⇒ défaut 20. Toute valeur invalide (NaN, négative, nulle, non
 * entière, texte) ⇒ MechanicConfigError avec un message clair — jamais un
 * plafond silencieusement désactivé (l'ancien `Number(x)` renvoyait NaN et
 * `count >= NaN` était toujours faux, ce qui SUPPRIMAIT le plafond).
 */
export function getMaxMechanicKeys(): number {
  const raw = process.env.GF_MAX_MECHANIC_KEYS
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_MECHANIC_KEYS
  const parsed = MAX_KEYS_SCHEMA.safeParse(raw)
  if (!parsed.success) {
    throw new MechanicConfigError(
      `Configuration invalide : GF_MAX_MECHANIC_KEYS="${raw}" (un entier strictement positif est attendu).`,
    )
  }
  return parsed.data
}

type MacInput = {
  licenseId: string
  token: string
  status: string
  expiryAt: Date
  hwid: string | null
  parentLicenseId: string | null
  mechanicId: string | null
}

/** Recalcule le recordMac pour l'état FINAL d'une clé (inclut parent/mechanic). */
export function macFor(input: MacInput): string {
  return computeRecordMac({
    licenseId: input.licenseId,
    token: input.token,
    status: input.status,
    expiryAt: input.expiryAt,
    hwid: input.hwid,
    parentLicenseId: input.parentLicenseId,
    mechanicId: input.mechanicId,
  })
}

/**
 * RÉPARATION des clés mécanicien ORPHELINES (`parentLicenseId = NULL`).
 *
 * Cause racine : `/api/admin/licenses/create` ne pose `parentLicenseId` que si la
 * licence garage parente est DÉJÀ enregistrée (contrainte de clé étrangère). Le
 * keygen enregistre les clés dans un ordre non garanti : si la clé mécanicien
 * arrive avant sa licence garage, le lien reste NULL — DÉFINITIVEMENT, car la
 * réconciliation de `GET /api/mechanic-licenses` cherche les clés PAR
 * `parentLicenseId`. La clé n'apparaît alors jamais chez le patron, ne peut pas
 * être attribuée, et l'activation répond `MECHANIC_KEY_UNASSIGNED`.
 *
 * Observé en production (2026-08-09) : clé `2a89048c-…` (`parentLicenseId` NULL)
 * alors que sa licence parente `3e619b98-…` existe dans la même base.
 *
 * Réparation : on ne se fie qu'au `plid` SIGNÉ contenu dans le jeton STOCKÉ — la
 * même source de confiance qu'à l'activation (`record.parentLicenseId ?? payload.plid`).
 * Un garage ne peut donc pas s'approprier la clé d'un autre : seules les clés
 * dont le parent figure dans `parentLids` sont touchées, et `parentLids` est
 * dérivé des licences du garage appelant.
 *
 * `parentLicenseId` entre dans le recordMac : il est recalculé, sinon
 * l'activation échouerait ensuite en « erreur d'intégrité ».
 *
 * @param parentLids licences garage de confiance (déjà rattachées au garage)
 * @param garageId   garage à poser sur la clé réparée (null = ne pas toucher)
 * @returns nombre de clés réparées
 */
export async function rebindOrphanMechanicKeys(
  parentLids: string[],
  garageId: string | null,
): Promise<number> {
  if (parentLids.length === 0) return 0
  const known = new Set(parentLids)

  // Seules les clés ORPHELINES et NON ATTRIBUÉES sont candidates : on ne
  // réécrit jamais un lien existant ni une clé déjà en service.
  const orphans = await prisma.licenseKey.findMany({
    where: { licenseType: 'mechanic', parentLicenseId: null, mechanicId: null },
    select: { licenseId: true, token: true, status: true, expiryAt: true, hwid: true, garageId: true },
    take: 500,
  })
  if (orphans.length === 0) return 0

  // Import tardif : évite un cycle mechanic-admin ↔ verify au chargement.
  const { verifyLicenseToken } = await import('@/lib/license/verify')

  let repaired = 0
  for (const o of orphans) {
    const v = verifyLicenseToken(o.token)
    const plid = v.valid && v.isMechanic ? v.payload?.plid : undefined
    if (!plid || !known.has(plid)) continue

    const recordMac = macFor({
      licenseId: o.licenseId, token: o.token, status: o.status,
      expiryAt: o.expiryAt, hwid: o.hwid, parentLicenseId: plid, mechanicId: null,
    })
    // Garde de concurrence : la clé doit toujours être orpheline et non attribuée.
    const res = await prisma.licenseKey.updateMany({
      where: { licenseId: o.licenseId, parentLicenseId: null, mechanicId: null },
      data: {
        parentLicenseId: plid,
        recordMac,
        ...(garageId && !o.garageId ? { garageId } : {}),
      },
    })
    repaired += res.count
  }
  return repaired
}

/**
 * DÉCONNEXION (≠ révocation) — §1/§2. Passe les appareils ACTIFS d'une licence à
 * l'état `deactivated` (= « disconnected ») : la SESSION est coupée et le SIÈGE
 * est LIBÉRÉ, mais l'appareil peut se RECONNECTER plus tard (réactivation) tant
 * que la licence reste valide. On ne révoque JAMAIS ici — une déconnexion n'est
 * pas une révocation, et ne consomme donc jamais définitivement un siège.
 * Retourne le nombre d'appareils déconnectés.
 */
export async function disconnectDevices(licenseId: string): Promise<number> {
  const res = await prisma.licenseDevice.updateMany({
    where: { licenseId, status: 'active' },
    data: { status: 'deactivated' },
  })
  if (res.count > 0) {
    await prisma.licenseDeviceEvent
      .create({ data: { licenseId, action: 'deactivated', detail: 'owner_disconnect' } })
      .catch(() => {}) // journal best-effort, jamais bloquant
  }
  return res.count
}

/**
 * RÉVOCATION des appareils — §1. Passe TOUS les appareils non révoqués (actifs OU
 * déconnectés) d'une licence à l'état `revoked`, PERMANENT : un appareil révoqué
 * ne peut plus se réactiver seul (activateDevice lève DeviceRevokedError).
 * À n'utiliser que pour une révocation réelle de licence, jamais pour une
 * simple déconnexion. Retourne le nombre d'appareils révoqués.
 */
export async function revokeDevices(licenseId: string, reason: string): Promise<number> {
  const res = await prisma.licenseDevice.updateMany({
    where: { licenseId, status: { in: ['active', 'deactivated'] } },
    data: { status: 'revoked', revokedAt: new Date(), revokeReason: reason.slice(0, 200) },
  })
  if (res.count > 0) {
    await prisma.licenseDeviceEvent
      .create({ data: { licenseId, action: 'revoked', detail: reason.slice(0, 200) } })
      .catch(() => {})
  }
  return res.count
}
