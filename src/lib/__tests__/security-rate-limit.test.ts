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
] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
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
