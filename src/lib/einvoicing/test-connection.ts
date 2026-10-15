/**
 * Test d'une connexion plateforme — logique partagée.
 *
 * Extraite de `/api/einvoicing/connection/test` le 15/08/2026 pour que la route
 * de session ET le tunnel poste → cloud (`/api/sync/einvoicing`) exécutent
 * EXACTEMENT le même code. Deux implémentations d'un test de connexion, c'est
 * la garantie qu'un jour l'une dira « connecté » quand l'autre dit « erreur ».
 *
 * Le résultat affiché vient d'une MESURE — un appel sortant réel vers la
 * plateforme — jamais d'une supposition. L'état de la connexion et le journal
 * d'audit sont écrits en conséquence.
 *
 * Module séparé plutôt qu'ajout à `connection.ts` : celui-ci ne connaît ni le
 * registre d'adaptateurs ni les drapeaux, et l'y faire dépendre créerait un
 * cycle d'imports.
 */
import { serverPrisma } from '@/lib/db'
import { einvoiceAdapterRegistry } from '@/lib/einvoicing/adapter'
import { enregistrerAdaptateurs } from '@/lib/einvoicing/registry'
import { dechiffrer, lireConnexion } from '@/lib/einvoicing/connection'
import type { EInvoiceEnvironment } from '@/lib/einvoicing/flags'

export interface ResultatTestConnexion {
  ok: boolean
  code?: string
  message?: string
  /** Statut HTTP que l'appelant doit rendre. */
  status: number
  [k: string]: unknown
}

/**
 * Teste la connexion du garage et enregistre la mesure.
 * Ne lève pas : les échecs sont retournés avec leur code et leur statut.
 */
export async function testerConnexion(
  garageId: string,
  environment: EInvoiceEnvironment,
  actorUserId: string | null,
): Promise<ResultatTestConnexion> {
  enregistrerAdaptateurs()

  const connexion = await lireConnexion(garageId, environment)
  if (!connexion) {
    return { ok: false, code: 'NO_CONNECTION', message: 'Aucune connexion configurée.', status: 409 }
  }

  const identifiants = dechiffrer(connexion.credentials)
  if (!identifiants) {
    return {
      ok: false,
      code: 'CONNECTION_UNUSABLE',
      message: 'Identifiants illisibles (clé de chiffrement absente ou modifiée). Ressaisissez-les.',
      status: 503,
    }
  }
  if (!einvoiceAdapterRegistry.hasAdapter(connexion.providerId)) {
    return { ok: false, code: 'NO_ADAPTER', message: 'Aucun connecteur disponible pour cette plateforme.', status: 409 }
  }

  const resultat = await einvoiceAdapterRegistry.getAdapter(connexion.providerId).testConnection({
    garageId,
    providerId: connexion.providerId,
    environment,
    credentials: identifiants as unknown as Record<string, string>,
    legalEntityId: connexion.legalEntityId ?? undefined,
  })

  // L'état affiché vient d'une MESURE, pas d'une supposition.
  await serverPrisma().garageEInvoiceConnection.update({
    where: { id: connexion.id },
    data: {
      lastTestedAt: new Date(),
      lastTestOk: resultat.ok,
      status: resultat.ok ? 'connected' : 'error',
    },
  })
  await serverPrisma().eInvoiceAuditEvent.create({
    data: {
      garageId, actorUserId, action: 'test',
      targetType: 'GarageEInvoiceConnection', targetId: connexion.id,
      metadata: JSON.stringify({ environment, ok: resultat.ok }),
    },
  })

  return { ...resultat, status: resultat.ok ? 200 : 502 }
}
