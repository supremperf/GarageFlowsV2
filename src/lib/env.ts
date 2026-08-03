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

    // Jetons d'appareil : le pepper HMAC doit être explicite et fort en prod
    // PWA (en Electron, le secret d'installation sert de repli légitime).
    if (isWeakSecret(process.env.DEVICE_TOKEN_PEPPER)) {
      issues.push({
        name: 'DEVICE_TOKEN_PEPPER',
        problem: 'absent, trop court ou générique (requis en production PWA — openssl rand -base64 32)',
      })
    }

    // Rate limiting distribué : sans Upstash, les routes sensibles seraient en
    // fail-closed permanent (503) — on refuse le démarrage pour l'expliciter.
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      issues.push({
        name: 'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN',
        problem: 'rate limiting distribué requis en production PWA (multi-instance)',
      })
    } else if (!/^https:\/\//i.test(process.env.UPSTASH_REDIS_REST_URL.trim())) {
      // L'API REST Upstash est en https:// (…upstash.io). Une URL rediss:// ou
      // malformée ferait échouer fetch → fail-closed 503 sur toutes les routes
      // critiques alors que la variable est « présente ». On l'attrape au démarrage.
      issues.push({
        name: 'UPSTASH_REDIS_REST_URL',
        problem: 'doit être l\'URL REST https:// (…upstash.io) — pas rediss:// ni une valeur malformée',
      })
    }

    // Proxy de confiance : clientIpFrom() n'utilise x-forwarded-for/x-real-ip
    // QUE derrière un proxy déclaré (VERCEL=1 ou TRUST_PROXY_HEADERS=1). Sans ce
    // signal, TOUTES les IP retombent sur la clé constante « unverified » : les
    // limites login/api/activation s'effondrent dans un seul bucket global (un
    // seul utilisateur peut épuiser la limite de tous — auto-DoS). Sur Vercel,
    // VERCEL=1 est fourni automatiquement ; en auto-hébergement, déclarez
    // explicitement TRUST_PROXY_HEADERS=1 UNIQUEMENT derrière un proxy fiable.
    if (process.env.VERCEL !== '1' && process.env.TRUST_PROXY_HEADERS !== '1') {
      issues.push({
        name: 'TRUST_PROXY_HEADERS',
        problem:
          "proxy de confiance non déclaré en production PWA — définissez TRUST_PROXY_HEADERS=1 " +
          "(derrière un proxy fiable) sinon les limites de débit s'effondrent en un seul bucket",
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
 * Clé AES-256 (base64, 32 octets) pour les sauvegardes chiffrées (GF_BACKUP_KEY),
 * ou `null` si absente — une passphrase par requête est alors requise. Quand elle
 * est présente, sa robustesse est validée (jamais de repli codé en dur) :
 * on LÈVE si elle est trop courte ou générique, pour éviter un chiffrement faible.
 */
export function backupKey(): string | null {
  const raw = process.env.GF_BACKUP_KEY?.trim()
  if (!raw) return null
  if (isWeakSecret(raw)) {
    throw new Error(
      'GF_BACKUP_KEY trop courte ou générique — générez une clé forte ' +
        '(« openssl rand -base64 32 »). Aucun repli codé en dur n\'est autorisé.',
    )
  }
  return raw
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
