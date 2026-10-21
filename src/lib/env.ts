/**
 * Validation centralisée des variables d'environnement (GarageFlow desktop/web).
 *
 * En production, le serveur REFUSE de démarrer (throw via src/instrumentation.ts)
 * si une variable critique est absente, vide, trop courte ou générique.
 * En développement, on émet un avertissement clair — sans jamais exposer la valeur.
 */
import { createHash } from 'node:crypto'
import { isWeakSecret } from '@/lib/auth-secret'

export type EnvIssue = { name: string; problem: string }

/**
 * Schéma d'un URL, destiné à un message d'erreur — JAMAIS la valeur, qui porte
 * l'hôte et les identifiants.
 *
 * Tout caractère inattendu est rendu par son POINT DE CODE (`U+0022`) et non par
 * un « ? » : un guillemet, une espace insécable, une marque d'ordre d'octets ou
 * une espace de largeur nulle produisent sinon le même symbole, alors que les
 * trois dernières sont INVISIBLES dans une interface web. Nommer le caractère
 * évite de corriger à l'aveugle une variable qui semble déjà correcte.
 */
function schemeOf(url: string): string {
  const i = url.indexOf('://')
  const brut = i > 0 ? url.slice(0, i) : url.slice(0, 12)
  return brut
    .slice(0, 16)
    .replace(/[^A-Za-z0-9+._-]/g, (c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
}

/**
 * Délai d'attente d'un appel Upstash, en millisecondes.
 *
 * DÉFAUT 1500 : la valeur qui était codée en dur dans `rate-limit.ts`. Sans
 * variable définie, le comportement reste donc rigoureusement inchangé.
 *
 * L'arbitrage n'est pas neutre : ce client sert un limiteur **fail-closed** en
 * production PWA. Quand Upstash ne répond pas, les routes critiques (connexion,
 * activation de licence) sont REFUSÉES. Un délai court coupe vite et renvoie une
 * erreur franche ; un délai long fait patienter l'appelant d'autant, requête
 * après requête, avant le même refus. D'où des bornes étroites — et un REFUS DE
 * DÉMARRER hors bornes en production PWA, plutôt qu'un rognage silencieux qui
 * masquerait une erreur de configuration (un `15000` saisi pour `1500`).
 *
 * La résolution vit ici, et non dans `rate-limit.ts`, pour deux raisons : la
 * validation est centralisée (un seul endroit décide de ce qui est acceptable),
 * et `rate-limit.ts` importe déjà ce module — l'inverse créerait un cycle.
 */
export const UPSTASH_TIMEOUT_DEFAUT_MS = 1500
export const UPSTASH_TIMEOUT_MIN_MS = 100
export const UPSTASH_TIMEOUT_MAX_MS = 10_000

/** Vrai si la valeur brute est un entier dans les bornes admises. */
function delaiUpstashValide(brut: string): boolean {
  if (!/^\d+$/.test(brut.trim())) return false
  const v = Number.parseInt(brut, 10)
  return v >= UPSTASH_TIMEOUT_MIN_MS && v <= UPSTASH_TIMEOUT_MAX_MS
}

export function upstashTimeoutMs(): number {
  const brut = process.env.UPSTASH_REDIS_TIMEOUT_MS
  if (!brut || !delaiUpstashValide(brut)) return UPSTASH_TIMEOUT_DEFAUT_MS
  return Number.parseInt(brut, 10)
}

function checkPresent(name: string, min: number, issues: EnvIssue[]): void {
  const v = process.env[name]
  if (!v || v.trim() === '') issues.push({ name, problem: 'absente ou vide' })
  else if (v.length < min) issues.push({ name, problem: `trop courte (< ${min} caractères)` })
}

/**
 * Empreinte de la CIBLE d'une URL de base : hôte + chemin, SANS les identifiants.
 *
 * Deux propriétés la rendent utilisable comme variable d'environnement ordinaire :
 *  · elle ne contient ni utilisateur ni mot de passe, donc ce n'est pas un secret
 *    et elle peut être déclarée en clair ;
 *  · elle est insensible au mot de passe, donc elle SURVIT à une rotation — la
 *    garde ci-dessous ne se périme pas le jour où les identifiants changent.
 *
 * @returns empreinte hexadécimale, ou null si l'URL est absente ou illisible.
 */
export function empreinteCibleBase(url: string | undefined | null): string | null {
  if (!url || !url.trim()) return null
  try {
    const u = new URL(url.trim())
    if (!u.host) return null
    return createHash('sha256').update(`${u.host}${u.pathname}`).digest('hex')
  } catch {
    return null
  }
}

/**
 * ISOLATION PREVIEW — un déploiement de prévisualisation ne doit JAMAIS écrire
 * dans la base de PRODUCTION.
 *
 * Le risque est structurel sur Vercel : une intégration Marketplace (Neon,
 * Upstash) est attachée au PROJET, donc ses variables sont injectées dans
 * Production ET Preview. Sans surcharge au niveau Preview, chaque branche
 * déployée écrit dans les données réelles des clients. Rien dans le code ne
 * distinguait les deux environnements avant cette garde (audit du 2026-10-20,
 * constat V-02) : `VERCEL_ENV` n'était lu que par la route de diagnostics.
 *
 * Fonctionnement : l'exploitant déclare `GF_PRODUCTION_DB_FINGERPRINT` (une
 * empreinte, pas un secret) sur TOUS les environnements. En Preview, si la base
 * visée porte cette empreinte, la configuration est refusée. Sur Vercel un
 * Preview a NODE_ENV=production, donc `assertEnv` LÈVE et le déploiement ne sert
 * aucune requête : fail-closed, jamais un avertissement qu'on finit par ignorer.
 *
 * Sans `GF_PRODUCTION_DB_FINGERPRINT`, la garde ne peut rien affirmer et se tait
 * — c'est pourquoi `check:env-vercel` doit exiger sa présence : une garde non
 * provisionnée est une garde absente.
 */
function verifierIsolationPreview(issues: EnvIssue[]): void {
  if (process.env.VERCEL_ENV !== 'preview') return
  const attendue = process.env.GF_PRODUCTION_DB_FINGERPRINT?.trim()
  if (!attendue) return
  const courante = empreinteCibleBase(process.env.DATABASE_URL)
  if (courante && courante === attendue) {
    issues.push({
      name: 'DATABASE_URL',
      problem:
        'déploiement Preview pointant vers la base de PRODUCTION — surchargez ' +
        'DATABASE_URL et DIRECT_URL au niveau Preview (branche Neon dédiée)',
    })
  }
}

/** Liste les problèmes détectés (vide = configuration valide). */
export function validateEnv(): { ok: boolean; issues: EnvIssue[] } {
  const issues: EnvIssue[] = []
  checkPresent('DATABASE_URL', 5, issues)
  if (isWeakSecret(process.env.NEXTAUTH_SECRET)) {
    issues.push({ name: 'NEXTAUTH_SECRET', problem: 'absente, trop courte ou générique' })
  }

  verifierIsolationPreview(issues)

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
    } else if (isSqlite) {
      issues.push({
        name: 'DATABASE_URL',
        problem: 'SQLite/stockage local interdit en production PWA — PostgreSQL requis',
      })
    } else if (!isPostgres) {
      // Un URL non reconnu N'EST PAS forcément du SQLite : confondre les deux
      // envoie chercher une base locale là où le défaut est un URL malformé
      // (guillemets conservés à la saisie, espace ou saut de ligne en tête,
      // schéma absent). On expose le SCHÉMA SEUL — jamais la valeur, qui porte
      // les identifiants de connexion.
      issues.push({
        name: 'DATABASE_URL',
        problem: `schéma non reconnu (« ${schemeOf(url)} ») — postgresql:// requis en production PWA`,
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

    // Délai d'appel Upstash : facultatif, mais s'il est FOURNI il doit être
    // exploitable. Le rogner en silence masquerait un « 15000 » saisi pour
    // « 1500 » — et ferait patienter chaque requête critique dix fois trop
    // longtemps avant le même refus.
    const delaiBrut = process.env.UPSTASH_REDIS_TIMEOUT_MS
    if (delaiBrut !== undefined && delaiBrut.trim() !== '' && !delaiUpstashValide(delaiBrut)) {
      issues.push({
        name: 'UPSTASH_REDIS_TIMEOUT_MS',
        problem:
          `doit être un entier de millisecondes entre ${UPSTASH_TIMEOUT_MIN_MS} et ${UPSTASH_TIMEOUT_MAX_MS} ` +
          `(absente = ${UPSTASH_TIMEOUT_DEFAUT_MS} par défaut)`,
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
