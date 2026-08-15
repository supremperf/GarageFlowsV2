/**
 * Rate limiting centralisé — UNIQUE implémentation autorisée du dépôt.
 *
 * Deux backends, choisis explicitement selon le mode d'exécution :
 *
 *  1. Upstash Redis (REST) — DISTRIBUÉ, obligatoire en production PWA
 *     (plusieurs instances Vercel). Compteur à fenêtre fixe incrémenté par un
 *     script Lua atomique (INCR + PEXPIRE + PTTL en une seule évaluation) :
 *     aucune course possible entre instances.
 *
 *  2. Mémoire locale (Map) — UNIQUEMENT pour :
 *       - Electron (ELECTRON=1) : serveur mono-processus lié à 127.0.0.1,
 *         un backend distribué n'aurait aucun sens ;
 *       - développement / tests (NODE_ENV !== 'production').
 *     En production PWA sans Redis, les routes sensibles répondent 503
 *     (fail-closed) — JAMAIS de repli mémoire silencieux qui donnerait
 *     l'illusion d'une protection distribuée (voir docs/PRODUCTION_DEPLOYMENT.md).
 *
 * Confidentialité des clés Redis : le sujet (IP, licenseId…) est TOUJOURS
 * haché (SHA-256 tronqué) avant de servir de clé — jamais de clé de licence
 * ni d'IP en clair dans Redis.
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { isPwaProduction, upstashTimeoutMs } from '@/lib/env'

// ─── Catégories et politiques ────────────────────────────────────────────────

export type RateLimitCategory =
  | 'login'            // connexion (next-auth credentials, activation de session)
  | 'license_activate' // POST /api/license/activate
  | 'license_status'   // GET /api/license/status, POST /api/license/check
  | 'admin'            // routes /api/admin/*
  | 'api'              // routes API générales authentifiées

interface Policy {
  max: number
  windowSec: number
  /** Fail-closed en production PWA quand le backend distribué est indisponible. */
  critical: boolean
}

function envInt(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : fallback
}


/** Politiques par défaut — surchargées par variables d'environnement. */
function policyFor(category: RateLimitCategory): Policy {
  switch (category) {
    case 'login':
      return {
        max:       envInt('RATE_LIMIT_LOGIN_MAX', 10),
        windowSec: envInt('RATE_LIMIT_LOGIN_WINDOW_SECONDS', 900),
        critical:  true,
      }
    case 'license_activate':
      return {
        max:       envInt('RATE_LIMIT_LICENSE_ACTIVATE_MAX', 5),
        windowSec: envInt('RATE_LIMIT_LICENSE_ACTIVATE_WINDOW_SECONDS', 900),
        critical:  true,
      }
    case 'license_status':
      return {
        max:       envInt('RATE_LIMIT_LICENSE_STATUS_MAX', 60),
        windowSec: envInt('RATE_LIMIT_LICENSE_STATUS_WINDOW_SECONDS', 60),
        critical:  true,
      }
    case 'admin':
      return {
        max:       envInt('RATE_LIMIT_ADMIN_MAX', 60),
        windowSec: envInt('RATE_LIMIT_ADMIN_WINDOW_SECONDS', 60),
        critical:  true,
      }
    case 'api':
      return {
        max:       envInt('RATE_LIMIT_API_MAX', 120),
        windowSec: envInt('RATE_LIMIT_API_WINDOW_SECONDS', 60),
        critical:  false,
      }
  }
}

// ─── Résultat ────────────────────────────────────────────────────────────────

export interface RateLimitDecision {
  ok: boolean
  remaining: number
  /** Secondes avant la fin de fenêtre — présent quand !ok (en-tête Retry-After). */
  retryAfterSec?: number
  /**
   * 'fail_closed' : backend distribué requis mais indisponible → refuser (503).
   * 'fail_open'   : backend indisponible sur une catégorie non critique → laissé
   *                 passer, journalisé (disponibilité > protection sur ces routes).
   */
  degraded?: 'fail_closed' | 'fail_open'
}

// ─── Backends ────────────────────────────────────────────────────────────────

interface HitResult { count: number; ttlMs: number }

interface Backend {
  readonly kind: 'upstash' | 'memory'
  hit(key: string, windowMs: number): Promise<HitResult>
  reset(key: string): Promise<void>
}

// Fenêtre fixe atomique : INCR + PEXPIRE (à la création) + PTTL, en un seul
// script Lua — l'évaluation est atomique côté Redis, y compris entre instances.
const LUA_HIT = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('PTTL', KEYS[1])
return {c, t}`

class UpstashBackend implements Backend {
  readonly kind = 'upstash' as const
  constructor(private url: string, private token: string) {}

  private async command(cmd: unknown[]): Promise<unknown> {
    const controller = new AbortController()
    // Relu à chaque appel : une surcharge en test ou un changement de
    // configuration ne doit pas dépendre de l'instant d'import du module.
    const timer = setTimeout(() => controller.abort(), upstashTimeoutMs())
    try {
      const res = await fetch(this.url, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body:   JSON.stringify(cmd),
        signal: controller.signal,
        cache:  'no-store',
      })
      if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`)
      const data = (await res.json()) as { result?: unknown; error?: string }
      if (data.error) throw new Error(`Upstash: ${data.error}`)
      return data.result
    } finally {
      clearTimeout(timer)
    }
  }

  async hit(key: string, windowMs: number): Promise<HitResult> {
    const result = await this.command(['EVAL', LUA_HIT, '1', key, String(windowMs)])
    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('Réponse Upstash inattendue')
    }
    const count = Number(result[0])
    const ttlMs = Number(result[1])
    if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
      throw new Error('Réponse Upstash non numérique')
    }
    return { count, ttlMs: ttlMs > 0 ? ttlMs : windowMs }
  }

  async reset(key: string): Promise<void> {
    await this.command(['DEL', key])
  }
}

class MemoryBackend implements Backend {
  readonly kind = 'memory' as const
  private store = new Map<string, { count: number; resetAt: number }>()
  private lastSweep = 0

  private sweep(now: number): void {
    // Nettoyage paresseux (pas de setInterval : compatible tests et serverless).
    if (now - this.lastSweep < 60_000) return
    this.lastSweep = now
    this.store.forEach((v, k) => {
      if (v.resetAt <= now) this.store.delete(k)
    })
  }

  async hit(key: string, windowMs: number): Promise<HitResult> {
    const now = Date.now()
    this.sweep(now)
    const entry = this.store.get(key)
    if (!entry || entry.resetAt <= now) {
      this.store.set(key, { count: 1, resetAt: now + windowMs })
      return { count: 1, ttlMs: windowMs }
    }
    entry.count += 1
    return { count: entry.count, ttlMs: entry.resetAt - now }
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key)
  }
}

// ─── Sélection du backend ────────────────────────────────────────────────────

let cachedBackend: Backend | null | undefined
let warnedMemory = false

/**
 * Nettoie une valeur d'environnement Upstash. ROBUSTESSE CRITIQUE : un retour à
 * la ligne / espace parasite (copié-collé, ou ajouté à l'écriture Vercel) casse
 * `fetch` AVANT tout appel réseau — un `\n` dans le token produit un en-tête
 * « Authorization: Bearer <token>\n » invalide (TypeError, aucune requête
 * sortante) → repli fail-closed 503 alors qu'Upstash est pourtant configuré
 * (symptôme observé : hasUpstash=true, degraded=fail_closed, ~47 ms). Ni l'URL
 * REST ni le token n'ont d'espace légitime : on retire tout blanc de bord et
 * tout CR/LF/tab (y compris interne, illégal dans un en-tête HTTP).
 */
function cleanUpstashValue(v: string | undefined): string {
  return (v ?? '').replace(/[\r\n\t]/g, '').trim()
}

function upstashConfig(): { url: string; token: string } | null {
  const url   = cleanUpstashValue(process.env.UPSTASH_REDIS_REST_URL)
  const token = cleanUpstashValue(process.env.UPSTASH_REDIS_REST_TOKEN)
  if (!url || !token) return null
  // URL invalide (protocole non http, ex. « rediss:// ») : inutilisable via l'API
  // REST — on la traite comme absente plutôt que de laisser fetch lever à chaque
  // requête (le configurateur exige déjà une URL https ...upstash.io).
  if (!/^https?:\/\//i.test(url)) return null
  return { url, token }
}

/**
 * Backend actif, ou null si un backend distribué est REQUIS mais absent
 * (production PWA sans Upstash) — les catégories critiques passeront en
 * fail-closed et les autres en fail-open journalisé.
 */
function resolveBackend(): Backend | null {
  if (cachedBackend !== undefined) return cachedBackend

  // ── Une suite de tests ne parle JAMAIS au Redis de production (GF-041) ──────
  // Le poste porte un `.env` avec des identifiants Upstash RÉELS : sous vitest,
  // `resolveBackend` ouvrait donc des compteurs sur le magasin PARTAGÉ. Deux
  // conséquences mesurées : les tests dépendaient de leur ordre d'exécution —
  // un fichier consommait le quota d'inscription portail, et le suivant
  // recevait un 429 qu'aucune de ses lignes n'expliquait — et chaque exécution
  // laissait des clés dans un service de production.
  //
  // Les tests qui vérifient précisément la SÉLECTION du backend posent
  // `GF_TEST_ALLOW_UPSTASH` : eux seuls voient la configuration distante, et
  // avec les valeurs qu'ils fournissent, jamais celles de l'environnement.
  const enTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)
  const upstash = enTest && process.env.GF_TEST_ALLOW_UPSTASH !== '1'
    ? null
    : upstashConfig()
  if (upstash) {
    cachedBackend = new UpstashBackend(upstash.url, upstash.token)
    return cachedBackend
  }

  const isElectron = process.env.ELECTRON === '1'
  if (isElectron || !isPwaProduction()) {
    // Mono-processus (Electron) ou dev/test : la Map locale est correcte ici.
    if (!isElectron && !warnedMemory && process.env.NODE_ENV !== 'test') {
      warnedMemory = true
      // eslint-disable-next-line no-console
      console.warn(
        '[rate-limit] Backend MÉMOIRE (dev/test uniquement) — configurez ' +
          'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN pour un déploiement multi-instance.',
      )
    }
    cachedBackend = new MemoryBackend()
    return cachedBackend
  }

  // Production PWA sans Redis : PAS de repli mémoire silencieux.
  cachedBackend = null
  return cachedBackend
}

/** Réservé aux tests : force un backend (ou `undefined` pour re-résoudre). */
export function __setRateLimitBackendForTests(backend?: Backend | null): void {
  cachedBackend = backend
  warnedMemory = false
}

// ─── Clés pseudonymisées ─────────────────────────────────────────────────────

/** Jamais de licence/IP en clair dans Redis : SHA-256 tronqué du sujet. */
function keyFor(category: RateLimitCategory, subject: string): string {
  const digest = crypto.createHash('sha256').update(`${category}:${subject}`).digest('hex')
  return `rl:${category}:${digest.slice(0, 32)}`
}

// ─── Extraction d'IP contrôlée ───────────────────────────────────────────────

/**
 * IP cliente pour le rate limiting.
 *
 * Les en-têtes x-forwarded-for/x-real-ip ne sont dignes de confiance QUE
 * derrière un proxy géré (Vercel les définit lui-même). En dehors de ce cas,
 * un client peut les forger pour contourner la limite : on n'utilise alors
 * qu'une valeur constante (le serveur Electron n'écoute que sur 127.0.0.1).
 */
export function clientIpFrom(req: Request): string {
  if (process.env.ELECTRON === '1') return 'local'
  const trusted = process.env.VERCEL === '1' || process.env.TRUST_PROXY_HEADERS === '1'
  if (!trusted) return 'unverified'
  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return fwd || 'unknown'
}

// ─── API principale ──────────────────────────────────────────────────────────

/**
 * Vérifie et incrémente le compteur pour (catégorie, sujet).
 * Le sujet est haché avant tout stockage. Ne lève jamais.
 */
export async function enforceRateLimit(
  category: RateLimitCategory,
  subject: string,
  override?: { max?: number; windowSec?: number },
): Promise<RateLimitDecision> {
  const policy = policyFor(category)
  const max = override?.max ?? policy.max
  const windowSec = override?.windowSec ?? policy.windowSec

  const backend = resolveBackend()
  if (!backend) {
    if (policy.critical) {
      return { ok: false, remaining: 0, retryAfterSec: 60, degraded: 'fail_closed' }
    }
    return { ok: true, remaining: max, degraded: 'fail_open' }
  }

  try {
    const { count, ttlMs } = await backend.hit(keyFor(category, subject), windowSec * 1000)
    if (count > max) {
      return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil(ttlMs / 1000)) }
    }
    return { ok: true, remaining: max - count }
  } catch {
    // Backend distribué configuré mais en panne : mêmes règles que « absent ».
    if (policy.critical && isPwaProduction()) {
      return { ok: false, remaining: 0, retryAfterSec: 60, degraded: 'fail_closed' }
    }
    return { ok: true, remaining: max, degraded: 'fail_open' }
  }
}

/** Réinitialise le compteur (ex. après une connexion réussie). Best-effort. */
export async function resetRateLimit(category: RateLimitCategory, subject: string): Promise<void> {
  const backend = resolveBackend()
  if (!backend) return
  try {
    await backend.reset(keyFor(category, subject))
  } catch {
    // best-effort
  }
}

/**
 * Réponse HTTP normalisée pour une décision négative :
 *  - 429 + Retry-After quand la limite est atteinte ;
 *  - 503 générique quand le backend requis est indisponible (fail-closed).
 * Aucun détail interne dans le corps.
 */
export function rateLimitResponse(decision: RateLimitDecision): NextResponse {
  if (decision.degraded === 'fail_closed') {
    return NextResponse.json(
      { error: 'Service temporairement indisponible. Réessayez plus tard.', code: 'SERVICE_UNAVAILABLE' },
      { status: 503, headers: { 'Retry-After': String(decision.retryAfterSec ?? 60) } },
    )
  }
  const retryAfter = decision.retryAfterSec ?? 60
  return NextResponse.json(
    { error: 'Trop de requêtes. Réessayez plus tard.', code: 'RATE_LIMITED' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  )
}
