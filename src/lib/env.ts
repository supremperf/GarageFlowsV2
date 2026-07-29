/**
 * Validation centralisée et typée des variables d'environnement.
 *
 * GarageFlowsV2 a deux cibles :
 *  - Bureau (Electron) : SQLite local, NEXTAUTH_SECRET généré automatiquement.
 *  - Web (app.garageflows.fr) : les secrets doivent être fournis.
 *
 * En production, un NEXTAUTH_SECRET absent/faible/d'exemple empêche le
 * démarrage (fail-fast). Ne logge JAMAIS la valeur d'un secret.
 */

export type EnvIssue = { name: string; problem: string }

const EXAMPLE_MARKERS = ['change_me', 'placeholder', 'example', 'xxxxx']

function looksLikeExample(value: string): boolean {
  const low = value.toLowerCase()
  return EXAMPLE_MARKERS.some((m) => low.includes(m))
}

function checkSecret(name: string, min: number, issues: EnvIssue[]): void {
  const v = process.env[name]
  if (!v || v.trim() === '') {
    issues.push({ name, problem: 'absente ou vide' })
  } else if (v.length < min) {
    issues.push({ name, problem: `trop courte (< ${min} caractères)` })
  } else if (looksLikeExample(v)) {
    issues.push({ name, problem: "égale à une valeur d'exemple" })
  }
}

/** Retourne la liste des problèmes détectés (vide = tout est valide). */
export function validateServerEnv(): { ok: boolean; issues: EnvIssue[] } {
  const issues: EnvIssue[] = []
  // Secret de session : critique sur toutes les cibles.
  checkSecret('NEXTAUTH_SECRET', 16, issues)
  // DATABASE_URL : requis (SQLite `file:` accepté pour le bureau).
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
    issues.push({ name: 'DATABASE_URL', problem: 'absente ou vide' })
  }
  return { ok: issues.length === 0, issues }
}

/**
 * À appeler au démarrage (src/instrumentation.ts).
 * Lève une erreur en production si NEXTAUTH_SECRET/DATABASE_URL sont invalides.
 */
export function assertServerEnv(): void {
  const { ok, issues } = validateServerEnv()
  if (ok) return
  const summary = issues.map((i) => `${i.name} (${i.problem})`).join(', ')
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Démarrage refusé — variables d'environnement invalides : ${summary}.`)
  }
  // eslint-disable-next-line no-console
  console.warn(`[env] Configuration incomplète (dev) : ${summary}`)
}
