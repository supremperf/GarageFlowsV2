/**
 * Facturation électronique — indicateurs de fonctionnalité (feature flags).
 *
 * TOUT est DÉSACTIVÉ par défaut. La fonctionnalité ne s'active JAMAIS d'elle-même
 * — en particulier PAS après un `scripts/RESET-GARAGEFLOW.cmd` : les variables
 * `EINVOICING_*` sont déclarées dans le manifeste avec `autoManage:false`, donc le
 * reset ne les force jamais (voir docs/EINVOICING_RESET_COMPATIBILITY.md).
 *
 * Aucun secret ici : uniquement des booléens de configuration lus CÔTÉ SERVEUR.
 * Les sous-fonctions n'ont d'effet que si le drapeau maître `enabled` est vrai
 * (garde globale), et l'environnement est verrouillé sur « sandbox » tant que
 * `sandboxOnly` est vrai (défaut) — aucune émission réelle par défaut.
 */

export type EInvoiceEnvironment = 'sandbox' | 'production'

export interface EInvoicingFlags {
  enabled: boolean
  providerCatalogEnabled: boolean
  connectionsEnabled: boolean
  outgoingEnabled: boolean
  incomingEnabled: boolean
  paymentReportingEnabled: boolean
  sandboxOnly: boolean
  defaultEnvironment: EInvoiceEnvironment
}

/** Parse une variable booléenne d'environnement de façon tolérante et sûre. */
function boolEnv(name: string, def: boolean): boolean {
  const v = process.env[name]
  if (v == null) return def
  const s = v.trim().toLowerCase()
  if (s === '1' || s === 'true' || s === 'on' || s === 'yes') return true
  if (s === '0' || s === 'false' || s === 'off' || s === 'no' || s === '') return false
  return def
}

export function getEInvoicingFlags(): EInvoicingFlags {
  const enabled = boolEnv('EINVOICING_ENABLED', false)
  const sandboxOnly = boolEnv('EINVOICING_SANDBOX_ONLY', true)

  const rawEnv = (process.env.EINVOICING_DEFAULT_ENVIRONMENT ?? 'sandbox').trim().toLowerCase()
  // Sécurité : tant que sandboxOnly est vrai, on FORCE sandbox quelle que soit la
  // valeur configurée — aucune transmission réelle possible par mégarde.
  const defaultEnvironment: EInvoiceEnvironment =
    sandboxOnly ? 'sandbox' : rawEnv === 'production' ? 'production' : 'sandbox'

  return {
    enabled,
    // Le catalogue est en lecture seule (aucun secret, aucun appel réseau) : il
    // peut rester visible même quand la fonctionnalité globale est désactivée.
    providerCatalogEnabled: boolEnv('EINVOICING_PROVIDER_CATALOG_ENABLED', true),
    connectionsEnabled: enabled && boolEnv('EINVOICING_CONNECTIONS_ENABLED', false),
    outgoingEnabled: enabled && boolEnv('EINVOICING_OUTGOING_ENABLED', false),
    incomingEnabled: enabled && boolEnv('EINVOICING_INCOMING_ENABLED', false),
    paymentReportingEnabled: enabled && boolEnv('EINVOICING_PAYMENT_REPORTING_ENABLED', false),
    sandboxOnly,
    defaultEnvironment,
  }
}
