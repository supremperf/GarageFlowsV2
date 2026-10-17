/**
 * /api/admin/licenses/revoke-by-key — la route est fermée sur Vercel par défaut,
 * et rate-limit fail-closed quand elle est explicitement autorisée.
 * Les succès sans ligne existante restent des no-op `not_registered`, pas des
 * preuves de révocation ni d'altération de licence.
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
  Reflect.set(process.env, 'VERCEL', '0')
  delete process.env.GF_REVOKE_BY_KEY_ENABLED
})

describe('revoke-by-key — rate limiting & outillage de confiance', () => {
  it('Vercel : désactivée par défaut sans flag explicite', async () => {
    process.env.VERCEL = '1'
    const res = await POST(req({ licenseId: 'x', status: 'revoked' }) as never)
    expect(res.status).toBe(404)
  })

  it('production self-hosted : désactivée par défaut aussi', async () => {
    const previous = process.env.NODE_ENV
    Reflect.set(process.env, 'NODE_ENV', 'production')
    try {
      const res = await POST(req({ licenseId: 'x', status: 'revoked' }) as never)
      expect(res.status).toBe(404)
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV')
      else Reflect.set(process.env, 'NODE_ENV', previous)
    }
  })

  it('Vercel : réouverture seulement avec GF_REVOKE_BY_KEY_ENABLED=true', async () => {
    process.env.VERCEL = '1'
    process.env.GF_REVOKE_BY_KEY_ENABLED = 'true'
    const res = await POST(req({ licenseId: 'config-test-flag', status: 'active' }) as never)
    expect(res.status).toBe(200)
  })

  it('fail_closed (Upstash indispo) → 503 avant comparaison de clé ou mutation', async () => {
    rlState.result = { ok: false, degraded: 'fail_closed', retryAfterSec: 60 }
    const res = await POST(req({ licenseId: 'config-test-x', status: 'active' }) as never)
    expect(res.status).toBe(503)
    expect(dbState.record).toBeNull()
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
