/**
 * server-schema-env.mjs — résolution d'environnement pour la VALIDATION STATIQUE
 * du schéma serveur.
 *
 * Isolé du script d'exécution pour être testable sans lancer Prisma (§135).
 */

/** Valeur de substitution : volontairement inexploitable comme vraie connexion. */
export const SUBSTITUT_VALIDATION = 'postgresql://validation-statique@127.0.0.1:5432/validation-statique'

/**
 * Rend l'environnement à utiliser pour `prisma validate --schema prisma/server/schema.prisma`.
 *
 * `directUrl = env("DIRECT_URL")` est OBLIGATOIRE pour Prisma, y compris pour une
 * validation qui n'ouvre aucune connexion. Sans repli, la commande documentée
 * échoue sur tout poste qui n'a pas de PostgreSQL — un gate toujours rouge, donc
 * un gate qu'on cesse de lire.
 *
 * On ne substitue JAMAIS quand la variable est fournie : les migrations réelles
 * doivent utiliser l'URL directe de l'exploitant, et rien d'autre.
 *
 * @param {Record<string,string|undefined>} env
 * @returns {{ env: Record<string,string|undefined>, substituted: boolean, source: 'fourni'|'DATABASE_URL'|'substitut' }}
 */
export function resolveValidationEnv(env) {
  if (env.DIRECT_URL) {
    return { env: { ...env }, substituted: false, source: 'fourni' }
  }
  // DATABASE_URL d'abord : la validation reste au plus près de la configuration
  // réelle du poste quand elle existe.
  const source = env.DATABASE_URL ? 'DATABASE_URL' : 'substitut'
  return {
    env: { ...env, DIRECT_URL: env.DATABASE_URL || SUBSTITUT_VALIDATION },
    substituted: true,
    source,
  }
}
