/**
 * INTÉGRATION — rate limiting distribué partagé entre plusieurs instances.
 *
 * Preuve exigée : le compteur est PARTAGÉ entre instances et l'incrément est
 * ATOMIQUE. On lance un mini-serveur HTTP local qui implémente le protocole
 * REST d'Upstash (POST / avec ["EVAL", …], Authorization: Bearer) au-dessus
 * d'un VRAI Redis (protocole RESP via socket TCP — aucun mock du comptage),
 * puis on charge DEUX instances indépendantes du module de rate limiting
 * (vi.resetModules ⇒ deux caches backend distincts, comme deux processus
 * Vercel) pointées sur ce même Redis.
 *
 * Prérequis : TEST_REDIS_URL=host:port (ex. 127.0.0.1:6379). Sans cette
 * variable, la suite est ignorée (skip) — la CI la fournit via un service Redis.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import net from 'net'
import http from 'http'
import type { AddressInfo } from 'net'

const REDIS = process.env.TEST_REDIS_URL // ex. "127.0.0.1:6379"

// ─── Client RESP minimal (vrai Redis, une connexion par commande) ────────────

function encodeRespCommand(args: string[]): Buffer {
  const parts = [`*${args.length}\r\n`]
  for (const a of args) {
    const buf = Buffer.byteLength(a, 'utf8')
    parts.push(`$${buf}\r\n${a}\r\n`)
  }
  return Buffer.from(parts.join(''), 'utf8')
}

type RespValue = string | number | null | RespValue[]

function parseResp(buf: Buffer, offset = 0): { value: RespValue; next: number } | null {
  if (offset >= buf.length) return null
  const lineEnd = buf.indexOf('\r\n', offset)
  if (lineEnd < 0) return null
  const type = String.fromCharCode(buf[offset])
  const head = buf.toString('utf8', offset + 1, lineEnd)
  const next = lineEnd + 2
  switch (type) {
    case '+': return { value: head, next }
    case '-': throw new Error(`Redis error: ${head}`)
    case ':': return { value: Number(head), next }
    case '$': {
      const len = Number(head)
      if (len === -1) return { value: null, next }
      if (buf.length < next + len + 2) return null
      return { value: buf.toString('utf8', next, next + len), next: next + len + 2 }
    }
    case '*': {
      const count = Number(head)
      if (count === -1) return { value: null, next }
      const items: RespValue[] = []
      let cursor = next
      for (let i = 0; i < count; i++) {
        const parsed = parseResp(buf, cursor)
        if (!parsed) return null
        items.push(parsed.value)
        cursor = parsed.next
      }
      return { value: items, next: cursor }
    }
    default:
      throw new Error(`Type RESP inconnu: ${type}`)
  }
}

function redisCall(hostPort: string, args: string[]): Promise<RespValue> {
  const [host, portStr] = hostPort.split(':')
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(portStr) || 6379 })
    let received = Buffer.alloc(0)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Redis timeout'))
    }, 3000)
    socket.on('connect', () => socket.write(encodeRespCommand(args)))
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk])
      try {
        const parsed = parseResp(received)
        if (parsed) {
          clearTimeout(timer)
          socket.end()
          resolve(parsed.value)
        }
      } catch (err) {
        clearTimeout(timer)
        socket.destroy()
        reject(err)
      }
    })
    socket.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

// ─── Shim REST Upstash au-dessus du vrai Redis ───────────────────────────────

const SHIM_TOKEN = 'test-shim-token'

function startShim(redisHostPort: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${SHIM_TOKEN}`) {
      res.writeHead(401).end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', async () => {
      try {
        const cmd = JSON.parse(body) as string[]
        const result = await redisCall(redisHostPort, cmd.map(String))
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ result }))
      } catch (err) {
        res.writeHead(500).end(JSON.stringify({ error: (err as Error).message }))
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

// ─── Deux instances indépendantes du module (≈ deux processus serveur) ───────

type RateLimitModule = typeof import('@/lib/security/rate-limit')

async function loadIsolatedInstance(): Promise<RateLimitModule> {
  vi.resetModules()
  return (await import('@/lib/security/rate-limit')) as RateLimitModule
}

describe.skipIf(!REDIS)('rate limiting distribué — partage réel entre instances (Redis requis)', () => {
  let shim: { url: string; close: () => Promise<void> }

  beforeAll(async () => {
    shim = await startShim(REDIS as string)
    process.env.UPSTASH_REDIS_REST_URL = shim.url
    process.env.UPSTASH_REDIS_REST_TOKEN = SHIM_TOKEN
    // GF-041 : sous vitest, `resolveBackend` ignore la configuration Upstash
    // sauf si le test déclare explicitement qu'il éprouve le backend DISTANT
    // (avec SES valeurs — ici le shim local, jamais la production). Sans ce
    // drapeau, chaque instance retombait sur sa propre Map mémoire : le
    // compteur n'était pas partagé et le test ne prouvait plus rien.
    process.env.GF_TEST_ALLOW_UPSTASH = '1'
  })

  afterAll(async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.GF_TEST_ALLOW_UPSTASH
    await shim?.close()
  })

  it('le compteur est partagé : instance B voit les hits de l\'instance A, 429 + Retry-After', async () => {
    const a = await loadIsolatedInstance()
    const b = await loadIsolatedInstance()
    const subject = `multi-${Date.now()}-${Math.random()}`

    // 3 hits sur l'instance A, 2 sur l'instance B (max 5)
    for (let i = 0; i < 3; i++) {
      expect((await a.enforceRateLimit('login', subject, { max: 5, windowSec: 30 })).ok).toBe(true)
    }
    for (let i = 0; i < 2; i++) {
      expect((await b.enforceRateLimit('login', subject, { max: 5, windowSec: 30 })).ok).toBe(true)
    }

    // 6e requête, quelle que soit l'instance → refusée (compteur partagé)
    const blockedOnB = await b.enforceRateLimit('login', subject, { max: 5, windowSec: 30 })
    expect(blockedOnB.ok).toBe(false)
    expect(blockedOnB.degraded).toBeUndefined() // vraie limite, pas une dégradation
    const blockedOnA = await a.enforceRateLimit('login', subject, { max: 5, windowSec: 30 })
    expect(blockedOnA.ok).toBe(false)

    const res = a.rateLimitResponse(blockedOnA)
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
    expect(Number(res.headers.get('Retry-After'))).toBeLessThanOrEqual(30)
  })

  it('l\'incrément est atomique : 20 requêtes concurrentes sur 2 instances, max 10 ⇒ exactement 10 admises', async () => {
    const a = await loadIsolatedInstance()
    const b = await loadIsolatedInstance()
    const subject = `atomic-${Date.now()}-${Math.random()}`

    const attempts = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 === 0 ? a : b).enforceRateLimit('license_activate', subject, { max: 10, windowSec: 30 }),
      ),
    )
    const admitted = attempts.filter((d) => d.ok).length
    expect(admitted).toBe(10)
    expect(attempts.filter((d) => !d.ok).length).toBe(10)
  })

  it('l\'expiration de la fenêtre fonctionne sur le vrai Redis', async () => {
    const a = await loadIsolatedInstance()
    const subject = `expire-${Date.now()}-${Math.random()}`
    expect((await a.enforceRateLimit('login', subject, { max: 1, windowSec: 1 })).ok).toBe(true)
    expect((await a.enforceRateLimit('login', subject, { max: 1, windowSec: 1 })).ok).toBe(false)
    await new Promise((r) => setTimeout(r, 1200))
    expect((await a.enforceRateLimit('login', subject, { max: 1, windowSec: 1 })).ok).toBe(true)
  })

  it('les clés Redis sont pseudonymisées : jamais de sujet en clair', async () => {
    const a = await loadIsolatedInstance()
    const rawLicense = `GF2.cle-secrete-${Date.now()}`
    await a.enforceRateLimit('license_activate', rawLicense, { max: 5, windowSec: 30 })

    const keys = (await redisCall(REDIS as string, ['KEYS', 'rl:*'])) as string[]
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(key).not.toContain(rawLicense)
      expect(key).toMatch(/^rl:[a-z_]+:[0-9a-f]{32}$/)
    }
  })

  it('nettoyage', async () => {
    const keys = (await redisCall(REDIS as string, ['KEYS', 'rl:*'])) as string[]
    for (const key of keys) await redisCall(REDIS as string, ['DEL', key])
    expect(true).toBe(true)
  })
})
