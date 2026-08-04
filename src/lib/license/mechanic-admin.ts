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

import { prisma } from '@/lib/db'
import { computeRecordMac } from '@/lib/license/record-mac'

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
