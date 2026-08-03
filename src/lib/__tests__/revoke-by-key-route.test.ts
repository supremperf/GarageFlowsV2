/**
 * /api/admin/licenses/revoke-by-key — le rate limiting ne doit JAMAIS bloquer
 * l'outillage de confiance (keygen, reset) sur une indisponibilité d'Upstash.
 *
 * Régression observée en production : le script de reset rote Upstash puis teste
 * cette route ; un repli fail-closed (503) cassait alors son propre test de clé
 * (et une réponse sans `ok` faisait planter le script sous Set-StrictMode).
 * Ici on prouve le contrat côté route : fail_closed → laissé passer (la clé API
 * reste le contrôle fort) ; vraie limite atteinte (429) → toujours bloquée.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rlState = vi.hoisted(() => ({ result: { ok: true, remaining: 99 } as Record<string, unknown> }))
vi.mock('@/lib/security/rate-limit', () => ({
  clientIpFrom: () => 'test-ip',
  enforceRateLimit: async () => rlState.result,
  rateLimitResponse: (d: { degraded?: string }) =>
    new Response(JSON.stringify({ error: 'rl' }), {
      status: d.degraded === 'fail_closed' ? 503 : 429,
      headers: { 'content-type': 'application/json' },
    }),
}))

const dbState = vi.hoisted(() => ({ record: null as unknown }))
vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findUnique: async () => dbState.record,
      create: async (args: { data: unknown }) => args.data,
      update: async (args: { data: unknown }) => args.data,
    },
  },
}))
vi.mock('@/lib/license/record-mac', () => ({ computeRecordMac: () => 'mac' }))

process.env.GARAGEFLOW_API_KEY = 'test-api-key-strong-0123456789'

import { POST } from '@/app/api/admin/licenses/revoke-by-key/route'

function req(body: unknown, key: string | null = process.env.GARAGEFLOW_API_KEY ?? null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (key) headers['x-gf-key'] = key
  return new Request('http://127.0.0.1/api/admin/licenses/revoke-by-key', {
    method: 'POST', headers, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  rlState.result = { ok: true, remaining: 99 }
  dbState.record = null
})

describe('revoke-by-key — rate limiting & outillage de confiance', () => {
  it('fail_closed (Upstash indispo) + clé valide → NON bloqué, réponse ok/not_registered', async () => {
    rlState.result = { ok: false, degraded: 'fail_closed', retryAfterSec: 60 }
    const res = await POST(req({ licenseId: 'config-test-x', status: 'active' }) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.note).toBe('not_registered')
  })

  it('vraie limite atteinte (429) → bloqué', async () => {
    rlState.result = { ok: false, retryAfterSec: 30 } // pas de degraded → 429
    const res = await POST(req({ licenseId: 'x', status: 'active' }) as never)
    expect(res.status).toBe(429)
  })

  it('clé API invalide → 403 (même si le rate limit passe)', async () => {
    const res = await POST(req({ licenseId: 'x', status: 'active' }, 'mauvaise-cle-0123456789') as never)
    expect(res.status).toBe(403)
  })

  it('en fonctionnement normal (rate limit ok) + clé valide → 200', async () => {
    const res = await POST(req({ licenseId: 'config-test-y', status: 'active' }) as never)
    expect(res.status).toBe(200)
    expect((await res.json()).note).toBe('not_registered')
  })
})
