/**
 * Autorisation des routes financières : un RECEPTIONIST (sans financial:read)
 * ne doit JAMAIS lire finance / rentabilité / prévisions / rapports / export FEC.
 * (Alignement de l'implémentation sur la matrice authz — faille corrigée.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ctx = vi.hoisted(() => ({ role: 'RECEPTIONIST' as string }))

vi.mock('@/lib/api-helpers', () => ({
  requireSession: async () => ({ user: { id: 'u1', role: ctx.role, garageId: 'gA' } }),
  withAuth: (h: (req: unknown, c?: unknown) => Promise<unknown>) =>
    async (req: unknown, c?: unknown) => { try { return await h(req, c) } catch (e) { if (e instanceof Response) return e; throw e } },
}))
// Prisma ne doit pas être atteint pour un RECEPTIONIST (le gate 403 arrive avant).
vi.mock('@/lib/db', () => ({ prisma: {}, isPostgresDatabase: () => false }))
vi.mock('@/lib/security/rate-limit', () => ({
  enforceRateLimit: async () => ({ ok: true }),
  rateLimitResponse: () => new Response('rl', { status: 429 }),
  clientIpFrom: () => 'ip',
}))

import { GET as FINANCE } from '@/app/api/finance/route'
import { GET as PROFIT } from '@/app/api/profitability/route'
import { GET as FORECAST } from '@/app/api/forecast/route'
import { GET as FEC } from '@/app/api/export/fec/route'
import { POST as REPORTS } from '@/app/api/reports/route'

const req = (url = 'http://127.0.0.1/x', method = 'GET') =>
  new Request(url, method === 'POST' ? { method, headers: { 'content-type': 'application/json' }, body: '{}' } : {})

const routes: Array<[string, (r: Request) => Promise<Response>]> = [
  ['finance', FINANCE as never],
  ['profitability', PROFIT as never],
  ['forecast', FORECAST as never],
  ['export/fec', FEC as never],
  ['reports', (r) => (REPORTS as never as (x: Request) => Promise<Response>)(req(r.url, 'POST'))],
]

beforeEach(() => { ctx.role = 'RECEPTIONIST' })

describe('RECEPTIONIST → 403 sur toutes les routes financières', () => {
  for (const [name, handler] of routes) {
    it(`/api/${name} refuse le RECEPTIONIST`, async () => {
      ctx.role = 'RECEPTIONIST'
      const res = await handler(req())
      expect(res.status).toBe(403)
    })
  }
})
