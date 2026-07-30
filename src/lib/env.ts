/**
 * Validation centralisée des variables d'environnement (GarageFlow desktop/web).
 *
 * En production, le serveur REFUSE de démarrer (throw via src/instrumentation.ts)
 * si une variable critique est absente, vide, trop courte ou générique.
 * En développement, on émet un avertissement clair — sans jamais exposer la valeur.
 */
import { isWeakSecret } from '@/lib/auth-secret'

export type EnvIssue = { name: string; problem: string }

function checkPresent(name: string, min: number, issues: EnvIssue[]): void {
  const v = process.env[name]
  if (!v || v.trim() === '') issues.push({ name, problem: 'absente ou vide' })
  else if (v.length < min) issues.push({ name, problem: `trop courte (< ${min} caractères)` })
}

/** Liste les problèmes détectés (vide = configuration valide). */
export function validateEnv(): { ok: boolean; issues: EnvIssue[] } {
  const issues: EnvIssue[] = []
  checkPresent('DATABASE_URL', 5, issues)
  if (isWeakSecret(process.env.NEXTAUTH_SECRET)) {
    issues.push({ name: 'NEXTAUTH_SECRET', problem: 'absente, trop courte ou générique' })
  }

  // ── Garde-fous PWA production (déploiement web multi-instance) ────────────────
  // Un déploiement PWA de production (NODE_ENV=production hors Electron) ne doit
  // JAMAIS démarrer sur SQLite / un fichier local : le disque est éphémère et non
  // partagé entre instances. On exige PostgreSQL.
  if (isPwaProduction()) {
    const url = process.env.DATABASE_URL ?? ''
    const isPostgres = /^postgres(ql)?:\/\//i.test(url)
    const isSqlite = url.startsWith('file:') || /\.db(\?|$)/.test(url) || /sqlite/i.test(url)
    if (!url) {
      issues.push({ name: 'DATABASE_URL', problem: 'PostgreSQL requis en production PWA (absent)' })
    } else if (isSqlite || !isPostgres) {
      issues.push({
        name: 'DATABASE_URL',
        problem: 'SQLite/stockage local interdit en production PWA — PostgreSQL requis',
      })
    }
  }

  return { ok: issues.length === 0, issues }
}

/** Vrai pour un serveur PWA de production (web multi-instance), faux sous Electron. */
export function isPwaProduction(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.ELECTRON !== '1'
}

/**
 * Appelée au démarrage (src/instrumentation.ts). Lève en production si la
 * configuration est invalide ; avertit seulement en développement.
 */
export function assertEnv(): void {
  const { ok, issues } = validateEnv()
  if (ok) return
  const summary = issues.map((i) => `${i.name} (${i.problem})`).join(', ')
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Démarrage refusé — variables d'environnement invalides : ${summary}. ` +
        "Configurez-les (jamais dans le dépôt). Générez un secret : « openssl rand -base64 32 ».",
    )
  }
  // eslint-disable-next-line no-console
  console.warn(`[env] Configuration incomplète (dev) : ${summary}`)
}
