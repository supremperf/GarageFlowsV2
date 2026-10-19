/**
 * Tests du VRAI module src/lib/security/rate-limit.ts (aucune copie inline).
 *
 * - backend mémoire : comptage, blocage, Retry-After, expiration de fenêtre ;
 * - politique fail-closed : production PWA sans backend distribué ⇒ refus 503
 *   des catégories critiques, jamais de repli mémoire silencieux ;
 * - pseudonymisation : jamais de sujet (licence/IP) en clair dans les clés ;
 * - extraction d'IP contrôlée (en-têtes proxy non fiables ignorés).
 *
 * Le partage multi-instance via Redis est prouvé séparément dans
 * rate-limit-multi-instance.int.test.ts (vrai Redis).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  enforceRateLimit,
  resetRateLimit,
  rateLimitResponse,
  clientIpFrom,
  __setRateLimitBackendForTests,
} from '@/lib/security/rate-limit'

const ENV_KEYS = [
  'ELECTRON', 'NODE_ENV', 'VERCEL', 'TRUST_PROXY_HEADERS',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  'RATE_LIMIT_LOGIN_MAX', 'RATE_LIMIT_LOGIN_WINDOW_SECONDS',
  'GF_TEST_ALLOW_UPSTASH',
] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  // Ce fichier est le SEUL à examiner la sélection du backend : il lui faut
  // donc voir la configuration Upstash — celle qu'il pose lui-même, jamais
  // celle de l'environnement. Partout ailleurs, la suite reste en mémoire pour
  // ne pas dépendre d'un service partagé, ni l'alimenter (GF-041).
  process.env.GF_TEST_ALLOW_UPSTASH = '1'
  delete (process.env as Record<string, string | undefined>).UPSTASH_REDIS_REST_URL
  delete (process.env as Record<string, string | undefined>).UPSTASH_REDIS_REST_TOKEN
  __setRateLimitBackendForTests(undefined)
})

afterEach(() => {
  const env = process.env as Record<string, string | undefined>
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete env[k]
    else env[k] = saved[k]
  }
  vi.unstubAllEnvs()
  __setRateLimitBackendForTests(undefined)
  vi.restoreAllMocks()
})

describe('GF-041 — la suite de tests ne parle jamais au Redis de production', () => {
  it('une configuration Upstash AMBIANTE est ignorée sous vitest', async () => {
    // Le poste porte un `.env` avec des identifiants réels. Sans cette garde,
    // `npm test` ouvrait des compteurs sur le magasin PARTAGÉ : les tests
    // devenaient dépendants de leur ordre — un fichier consommait le quota
    // d'inscription portail, le suivant recevait un 429 inexplicable — et
    // chaque exécution laissait des clés dans un service de production.
    delete (process.env as Record<string, string | undefined>).GF_TEST_ALLOW_UPSTASH
    process.env.UPSTASH_REDIS_REST_URL = 'https://exemple.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'jeton-fictif'
    __setRateLimitBackendForTests(undefined)

    // Aucun appel réseau ne doit partir : `fetch` est piégé.
    const reseau = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('réseau interdit'))
    const sujet = `gf041-${Math.random()}`
    const d = await enforceRateLimit('login', sujet, { max: 2, windowSec: 60 })

    expect(d.ok, 'le backend mémoire doit répondre').toBe(true)
    expect(d.degraded, 'ni fail-open ni fail-closed : un vrai compteur local').toBeUndefined()
    expect(reseau, 'aucune requête vers Upstash').not.toHaveBeenCalled()
  })

  it('le fichier qui TESTE la sélection garde accès à Upstash', async () => {
    // Sans cette porte, ce fichier ne pourrait plus vérifier le fail-closed ni
    // le nettoyage des valeurs d'environnement.
    process.env.GF_TEST_ALLOW_UPSTASH = '1'
    process.env.UPSTASH_REDIS_REST_URL = 'https://exemple.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'jeton-fictif'
    __setRateLimitBackendForTests(undefined)

    const reseau = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('hors ligne'))
    await enforceRateLimit('login', `gf041b-${Math.random()}`, { max: 2, windowSec: 60 })
    expect(reseau, 'le backend distant est bien sélectionné').toHaveBeenCalled()
  })
})

describe('backend mémoire (Electron/dev/test)', () => {
  it('autorise puis bloque après max, avec Retry-After', async () => {
    const subject = `s-${Math.random()}`
    for (let i = 0; i < 3; i++) {
      const d = await enforceRateLimit('login', subject, { max: 3, windowSec: 60 })
      expect(d.ok).toBe(true)
    }
    const blocked = await enforceRateLimit('login', subject, { max: 3, windowSec: 60 })
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1)
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60)
  })

  it('les fenêtres expirent', async () => {
    vi.useFakeTimers()
    try {
      const subject = `s-${Math.random()}`
      await enforceRateLimit('login', subject, { max: 1, windowSec: 1 })
      expect((await enforceRateLimit('login', subject, { max: 1, windowSec: 1 })).ok).toBe(false)
      vi.advanceTimersByTime(1100)
      expect((await enforceRateLimit('login', subject, { max: 1, windowSec: 1 })).ok).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('les catégories/sujets sont isolés', async () => {
    const subject = `s-${Math.random()}`
    await enforceRateLimit('login', subject, { max: 1, windowSec: 60 })
    expect((await enforceRateLimit('login', subject, { max: 1, windowSec: 60 })).ok).toBe(false)
    // Autre catégorie, même sujet → compteur distinct
    expect((await enforceRateLimit('admin', subject, { max: 1, windowSec: 60 })).ok).toBe(true)
    // Même catégorie, autre sujet → compteur distinct
    expect((await enforceRateLimit('login', `${subject}-2`, { max: 1, windowSec: 60 })).ok).toBe(true)
  })

  it('resetRateLimit vide le compteur', async () => {
    const subject = `s-${Math.random()}`
    await enforceRateLimit('login', subject, { max: 1, windowSec: 60 })
    expect((await enforceRateLimit('login', subject, { max: 1, windowSec: 60 })).ok).toBe(false)
    await resetRateLimit('login', subject)
    expect((await enforceRateLimit('login', subject, { max: 1, windowSec: 60 })).ok).toBe(true)
  })

  it('lit les politiques dans les variables d\'environnement', async () => {
    process.env.RATE_LIMIT_LOGIN_MAX = '2'
    process.env.RATE_LIMIT_LOGIN_WINDOW_SECONDS = '60'
    const subject = `s-${Math.random()}`
    expect((await enforceRateLimit('login', subject)).ok).toBe(true)
    expect((await enforceRateLimit('login', subject)).ok).toBe(true)
    expect((await enforceRateLimit('login', subject)).ok).toBe(false)
  })
})

describe('production PWA sans backend distribué — fail-closed', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    __setRateLimitBackendForTests(undefined)
  })

  it('refuse les catégories critiques (aucun repli mémoire silencieux)', async () => {
    for (const category of ['login', 'license_activate', 'license_status', 'admin'] as const) {
      const d = await enforceRateLimit(category, 'x')
      expect(d.ok).toBe(false)
      expect(d.degraded).toBe('fail_closed')
    }
  })

  it('fail-closed produit une réponse 503 générique avec Retry-After', async () => {
    const d = await enforceRateLimit('login', 'x')
    const res = rateLimitResponse(d)
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/upstash|redis|prisma|postgres/i)
  })

  it('catégorie non critique : fail-open explicite (jamais silencieux)', async () => {
    const d = await enforceRateLimit('api', 'x')
    expect(d.ok).toBe(true)
    expect(d.degraded).toBe('fail_open')
  })

  it('sous Electron, le backend mémoire reste légitime même en production', async () => {
    process.env.ELECTRON = '1'
    __setRateLimitBackendForTests(undefined)
    const d = await enforceRateLimit('login', 'x', { max: 1, windowSec: 60 })
    expect(d.ok).toBe(true)
    expect(d.degraded).toBeUndefined()
  })
})

describe('réponse 429', () => {
  it('contient Retry-After et un corps générique', async () => {
    const subject = `s-${Math.random()}`
    await enforceRateLimit('login', subject, { max: 1, windowSec: 60 })
    const d = await enforceRateLimit('login', subject, { max: 1, windowSec: 60 })
    const res = rateLimitResponse(d)
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
    const body = await res.json()
    expect(body.code).toBe('RATE_LIMITED')
  })
})

describe('pseudonymisation des clés', () => {
  it('le sujet (clé de licence, IP) n\'apparaît jamais en clair dans la clé backend', async () => {
    const seen: string[] = []
    __setRateLimitBackendForTests({
      kind: 'memory',
      hit: async (key: string) => {
        seen.push(key)
        return { count: 1, ttlMs: 1000 }
      },
      reset: async () => {},
    } as never)
    const secret = 'GF2.super-cle-de-licence-secrete.xyz'
    await enforceRateLimit('license_activate', secret)
    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toContain(secret)
    expect(seen[0]).toMatch(/^rl:license_activate:[0-9a-f]{32}$/)
  })
})

describe('clientIpFrom — en-têtes proxy contrôlés', () => {
  function reqWith(headers: Record<string, string>): Request {
    return new Request('http://x/', { headers })
  }

  it('Electron → local (loopback uniquement)', () => {
    process.env.ELECTRON = '1'
    expect(clientIpFrom(reqWith({ 'x-forwarded-for': '9.9.9.9' }))).toBe('local')
  })

  it('hors proxy de confiance, les en-têtes forgés sont ignorés', () => {
    delete process.env.ELECTRON
    delete process.env.VERCEL
    delete process.env.TRUST_PROXY_HEADERS
    expect(clientIpFrom(reqWith({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8' }))).toBe('unverified')
  })

  it('derrière Vercel, x-real-ip prime puis x-forwarded-for', () => {
    delete process.env.ELECTRON
    process.env.VERCEL = '1'
    expect(clientIpFrom(reqWith({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.2.3.4')
    expect(clientIpFrom(reqWith({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' }))).toBe('5.6.7.8')
  })
})

// ─── Robustesse Upstash : valeur d'env avec retour à la ligne parasite ────────
// Régression production : hasUpstash=true mais degraded=fail_closed, ~47 ms,
// aucun appel sortant → un « \n » dans le token forme « Bearer <token>\n »,
// en-tête HTTP invalide → fetch lève AVANT toute requête → repli fail-closed
// sur toutes les routes critiques. upstashConfig() nettoie désormais la valeur.
describe('robustesse Upstash — valeurs d\'environnement nettoyées', () => {
  it('un token avec \\n ne casse plus fetch (Authorization nettoyé) et évite le fail-closed', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.VERCEL = '1'
    process.env.UPSTASH_REDIS_REST_URL = 'https://demo.upstash.io\n'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok_abc123\n'
    __setRateLimitBackendForTests(undefined)

    let capturedAuth: unknown = null
    const mockFetch = vi.fn(async (_url: unknown, init: { headers: Record<string, string> }) => {
      capturedAuth = init.headers.Authorization
      return { ok: true, json: async () => ({ result: [1, 60000] }) } as unknown as Response
    })
    vi.stubGlobal('fetch', mockFetch)

    const d = await enforceRateLimit('login', 'ip-x')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(capturedAuth).toBe('Bearer tok_abc123')     // aucun \n
    expect(String(capturedAuth)).not.toMatch(/[\r\n]/)
    expect(d.ok).toBe(true)
    expect(d.degraded).toBeUndefined()
  })

  it('URL rediss:// (non REST) → traitée comme absente, sans fetch qui lève en boucle', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.VERCEL = '1'
    process.env.UPSTASH_REDIS_REST_URL = 'rediss://default:xxx@host:6379'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok'
    __setRateLimitBackendForTests(undefined)
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const d = await enforceRateLimit('login', 'ip-y')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(d.degraded).toBe('fail_closed') // critical + pas de backend REST valide
  })
})
