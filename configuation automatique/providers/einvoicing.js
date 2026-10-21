'use strict'
/**
 * FACTURATION ÉLECTRONIQUE — contrôle, jamais activation.
 *
 * Le dépôt est explicite (`src/lib/einvoicing/flags.ts`) : tout est désactivé
 * par défaut, et `EINVOICING_SANDBOX_ONLY` verrouille l'environnement sur
 * `sandbox` quelles que soient les autres valeurs. Ce n'est pas une précaution
 * décorative : une émission réelle envoie un document fiscal à une plateforme
 * agréée, opération qui ne se rejoue pas.
 *
 * Le configurateur ne fait donc ici que deux choses :
 *   · constater l'état des drapeaux, en reproduisant la logique du code (y
 *     compris le verrouillage sandbox) ;
 *   · REFUSER toute configuration qui activerait une émission réelle, et le
 *     signaler comme anomalie bloquante plutôt que de la propager.
 */

const DRAPEAUX = [
  'EINVOICING_ENABLED',
  'EINVOICING_PROVIDER_CATALOG_ENABLED',
  'EINVOICING_CONNECTIONS_ENABLED',
  'EINVOICING_OUTGOING_ENABLED',
  'EINVOICING_INCOMING_ENABLED',
  'EINVOICING_PAYMENT_REPORTING_ENABLED',
  'EINVOICING_SANDBOX_ONLY',
]

/** Lecture tolérante d'un booléen, à l'identique de `boolEnv` du dépôt. */
function booleen(valeur, defaut) {
  if (valeur === undefined || valeur === null) return defaut
  const propre = String(valeur).trim().toLowerCase()
  if (['1', 'true', 'on', 'yes'].includes(propre)) return true
  if (['0', 'false', 'off', 'no', ''].includes(propre)) return false
  return defaut
}

/**
 * Reproduit `getEInvoicingFlags()` et contrôle la sûreté de l'état.
 *
 * @returns {{ etat: object, sandboxVerrouille: boolean, anomalies: string[],
 *             emissionReellePossible: boolean }}
 */
function verifier(valeurs) {
  const active = booleen(valeurs.EINVOICING_ENABLED, false)
  const sandboxSeul = booleen(valeurs.EINVOICING_SANDBOX_ONLY, true)
  const brut = String(valeurs.EINVOICING_DEFAULT_ENVIRONMENT === undefined ? 'sandbox' : valeurs.EINVOICING_DEFAULT_ENVIRONMENT)
    .trim().toLowerCase()
  const environnement = sandboxSeul ? 'sandbox' : brut === 'production' ? 'production' : 'sandbox'

  const etat = {
    active,
    catalogue: booleen(valeurs.EINVOICING_PROVIDER_CATALOG_ENABLED, true),
    connexions: active && booleen(valeurs.EINVOICING_CONNECTIONS_ENABLED, false),
    emission: active && booleen(valeurs.EINVOICING_OUTGOING_ENABLED, false),
    reception: active && booleen(valeurs.EINVOICING_INCOMING_ENABLED, false),
    rapportPaiement: active && booleen(valeurs.EINVOICING_PAYMENT_REPORTING_ENABLED, false),
    sandboxSeul,
    environnement,
  }

  const anomalies = []
  if (!sandboxSeul) {
    anomalies.push('EINVOICING_SANDBOX_ONLY vaut false : le verrou qui empêche une transmission réelle est levé. '
      + 'Le configurateur ne pose jamais cette valeur et ne la propage pas.')
  }
  if (environnement === 'production') {
    anomalies.push('EINVOICING_DEFAULT_ENVIRONMENT vaut production : les échanges viseraient la plateforme réelle.')
  }
  if (etat.emission && !sandboxSeul) {
    anomalies.push('Émission sortante active hors sandbox : configuration refusée par le configurateur (opération fiscale irréversible).')
  }
  if (active && !valeurs.GF_EINVOICE_CREDENTIALS_KEY) {
    anomalies.push('EINVOICING_ENABLED est vrai mais GF_EINVOICE_CREDENTIALS_KEY est absente : les identifiants de plateforme ne peuvent pas être chiffrés.')
  }

  return {
    etat,
    sandboxVerrouille: sandboxSeul,
    anomalies,
    emissionReellePossible: etat.emission && !sandboxSeul,
  }
}

/**
 * Valeurs que le configurateur accepte d'inscrire : uniquement les défauts
 * sûrs, et seulement si la variable est absente. Aucune activation.
 */
function valeursSures(valeurs) {
  const sures = {}
  const defauts = {
    EINVOICING_ENABLED: 'false',
    EINVOICING_SANDBOX_ONLY: 'true',
    EINVOICING_DEFAULT_ENVIRONMENT: 'sandbox',
    EINVOICING_CONNECTIONS_ENABLED: 'false',
    EINVOICING_OUTGOING_ENABLED: 'false',
    EINVOICING_INCOMING_ENABLED: 'false',
    EINVOICING_PAYMENT_REPORTING_ENABLED: 'false',
    EINVOICING_PROVIDER_CATALOG_ENABLED: 'true',
  }
  for (const [nom, defaut] of Object.entries(defauts)) {
    if (valeurs[nom] === undefined || String(valeurs[nom]).trim() === '') sures[nom] = defaut
  }
  return sures
}

module.exports = { DRAPEAUX, booleen, verifier, valeursSures }
