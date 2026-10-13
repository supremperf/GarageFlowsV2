/**
 * toolchain-versions.mjs — cœur TESTABLE de la résolution de versions de toolchain.
 *
 * Distingue rigoureusement :
 *   - la PLAGE DÉCLARÉE   (`package.json`, ex. « ^5.16.1 ») — une contrainte semver ;
 *   - la VERSION RÉSOLUE  (réellement installée / verrouillée, ex. « 5.22.0 »).
 *
 * INTERDIT : présenter une plage tronquée (`"^5.16.1".replace(/^[\^~]/,'')` →
 * « 5.16.1 ») comme la version installée. « ^5.16.1 » N'EST PAS « 5.16.1 installé ».
 *
 * Priorité de résolution : node_modules (installé, fiable) > package-lock
 * (verrouillé) > null (NOT_RESOLVED — jamais inventé).
 *
 * Fonctions PURES : aucune I/O. L'appelant fournit `installed` (version lue dans
 * node_modules) et `lock` (package-lock.json parsé).
 */

/** Plage déclarée d'une dépendance dans package.json (deps ou devDeps), ou null. */
export function declaredRange(pkg, name) {
  return pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name] ?? null
}

/**
 * Résout la version RÉELLE d'une dépendance.
 * @param {string} name
 * @param {Object} [sources]
 * @param {string|null} [sources.installed]
 * @param {any} [sources.lock]
 * @returns {{ resolved: (string|null), source: (string|null), status?: string }}
 */
export function resolveVersion(name, { installed = null, lock = null } = {}) {
  if (installed && typeof installed === 'string') {
    return { resolved: installed, source: 'node_modules' }
  }
  const fromLock = lock?.packages?.[`node_modules/${name}`]?.version
  if (fromLock && typeof fromLock === 'string') {
    return { resolved: fromLock, source: 'package-lock' }
  }
  return { resolved: null, source: null, status: 'NOT_RESOLVED' }
}

/**
 * Construit l'entrée baseline d'une dépendance : { declared, resolved, source|status }.
 * `resolved` provient TOUJOURS de la version réelle, jamais de la plage tronquée.
 * @param {any} pkg
 * @param {string} name
 * @param {Object} [sources]
 * @param {string|null} [sources.installed]
 * @param {any} [sources.lock]
 * @returns {{ declared: (string|null), resolved: (string|null), source?: string, status?: string }}
 */
export function buildDependency(pkg, name, { installed = null, lock = null } = {}) {
  const declared = declaredRange(pkg, name)
  const { resolved, source, status } = resolveVersion(name, { installed, lock })
  const entry = { declared: declared ?? null, resolved }
  if (source) entry.source = source
  if (status) entry.status = status
  return entry
}

/** Composants critiques de la toolchain suivis dans la baseline (ordre d'affichage). */
export const CRITICAL_DEPENDENCIES = [
  'next',
  'react',
  'react-dom',
  'typescript',
  'prisma',
  '@prisma/client',
  'electron',
  'vitest',
]

/**
 * Construit la carte { name: { declared, resolved, … } } pour toutes les
 * dépendances critiques. `readInstalled(name)` renvoie la version node_modules
 * (ou null) ; `lock` est le package-lock.json parsé (ou null).
 * @param {any} pkg
 * @param {Object} [opts]
 * @param {(name: string) => (string|null)} [opts.readInstalled]
 * @param {any} [opts.lock]
 * @param {string[]} [opts.names]
 * @returns {Record<string, { declared: (string|null), resolved: (string|null), source?: string, status?: string }>}
 */
export function buildDependencyMap(pkg, { readInstalled = () => null, lock = null, names = CRITICAL_DEPENDENCIES } = {}) {
  const map = {}
  for (const name of names) {
    map[name] = buildDependency(pkg, name, { installed: readInstalled(name), lock })
  }
  return map
}
