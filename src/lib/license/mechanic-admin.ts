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
 * Désactive TOUS les appareils actifs d'une licence (révocation logique) et fait
 * tourner leur tokenVersion. Retourne le nombre d'appareils touchés. Les
 * sessions liées à ces appareils échouent au prochain contrôle.
 */
export async function disconnectDevices(licenseId: string, reason: string): Promise<number> {
  const res = await prisma.licenseDevice.updateMany({
    where: { licenseId, status: 'active' },
    data: { status: 'revoked', revokedAt: new Date(), revokeReason: reason },
  })
  return res.count
}
