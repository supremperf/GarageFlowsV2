/**
 * Enregistrement des adaptateurs RÉELS de facturation électronique.
 *
 * `adapter.ts` définit le contrat et expose un registre volontairement vide ;
 * ce module est le seul endroit où un connecteur y est inscrit. La séparation
 * est délibérée : elle garde `adapter.ts` sans dépendance et rend visible, en un
 * seul fichier, ce que le produit sait réellement faire.
 *
 * RÈGLE : n'inscrire ici QU'un adaptateur qui parle réellement au réseau. Un
 * stub qui simulerait un envoi réussi rendrait tout le dispositif mensonger — et
 * `isPlatformConnectable()` s'appuie sur ce registre pour décider si une
 * plateforme est proposée à la connexion dans l'interface.
 */

import { einvoiceAdapterRegistry } from './adapter'
import { genericPaAdapter, GENERIC_PA_ADAPTER_ID } from './adapters/generic-pa'

let inscrit = false

/**
 * Inscrit les connecteurs disponibles. Idempotent : appelable à chaque requête
 * sans effet cumulatif (les routes serveur sont sans état entre invocations).
 */
export function enregistrerAdaptateurs(): void {
  if (inscrit) return
  einvoiceAdapterRegistry.register(genericPaAdapter)
  inscrit = true
}

/** Réinitialise le registre — usage TEST uniquement. */
export function reinitialiserAdaptateurs(): void {
  inscrit = false
}

export { GENERIC_PA_ADAPTER_ID }
