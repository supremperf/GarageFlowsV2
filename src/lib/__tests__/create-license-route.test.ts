/**
 * POST /api/admin/licenses/create — enregistrement d'une licence signée par le
 * keygen. Le keygen appelait cet endpoint qui N'EXISTAIT PAS (→ route dynamique
 * [id] → HTTP 405). Ce test verrouille le contrat de la nouvelle route :
 *  - auth par clé API (x-gf-key) comme revoke-by-key ;
 *  - vérification cryptographique du token (verifyLicenseToken) — pas de forge ;
 *  - clé mécanicien : parentLicenseId posé SEULEMENT si le garage parent existe
 *    (sinon null → pas de violation de FK, l'activation retombe sur le plid signé) ;
 *  - idempotence (déjà enregistrée → 409, traité comme succès par le keygen) ;
 *  - le rate limit ne bloque pas l'outillage de confiance sur fail_closed.
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

const dbState = vi.hoisted(() => ({
  existing: null as { licenseId: string; status: string } | null,
  parents: new Set<string>(),
  created: null as Record<string, unknown> | null,
  createThrows: null as { code?: string } | null,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findUnique: async (args: { where: { licenseId: string } }) => {
        const lid = args.where.licenseId
        if (dbState.existing && dbState.existing.licenseId === lid) return dbState.existing
        if (dbState.parents.has(lid)) return { licenseId: lid }
        return null
      },
      create: async (args: { data: Record<string, unknown> }) => {
        if (dbState.createThrows) throw dbState.createThrows
        dbState.created = args.data
        return args.data
      },
    },
  },
}))
vi.mock('@/lib/license/record-mac', () => ({ computeRecordMac: () => 'mac' }))

const vState = vi.hoisted(() => ({ result: null as Record<string, unknown> | null }))
vi.mock('@/lib/license/verify', () => ({ verifyLicenseToken: () => vState.result }))

process.env.GARAGEFLOW_API_KEY = 'test-api-key-strong-0123456789'

import { POST } from '@/app/api/admin/licenses/create/route'

function req(body: unknown, key: string | null = process.env.GARAGEFLOW_API_KEY ?? null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (key) headers['x-gf-key'] = key
  return new Request('http://127.0.0.1/api/admin/licenses/create', {
    method: 'POST', headers, body: JSON.stringify(body),
  })
}

const garagePayload = {
  lid: 'L-garage', cid: 'CUST-1', typ: 'premium', iss: 1,
  exp: Math.floor(Date.now() / 1000) + 3600, seats: 3, wm: 'w', ver: '2.0',
}
const mechPayload = { ...garagePayload, lid: 'L-mech', typ: 'mechanic', plid: 'L-garage', mn: 'Alice' }

beforeEach(() => {
  rlState.result = { ok: true, remaining: 99 }
  dbState.existing = null
  dbState.parents = new Set()
  dbState.created = null
  dbState.createThrows = null
  vState.result = { valid: true, payload: garagePayload, isAdmin: false, isMechanic: false }
})

describe('POST /api/admin/licenses/create', () => {
  it('token garage valide + clé valide → 201, création avec recordMac', async () => {
    const res = await POST(req({ token: 'GF2.x' }) as never)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.licenseId).toBe('L-garage')
    expect(dbState.created?.recordMac).toBe('mac')
    expect(dbState.created?.parentLicenseId).toBe(null)
    expect(dbState.created?.status).toBe('active')
  })

  it('déjà enregistrée → 409 (succès côté keygen)', async () => {
    dbState.existing = { licenseId: 'L-garage', status: 'active' }
    const res = await POST(req({ token: 'GF2.x' }) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).alreadyRegistered).toBe(true)
  })

  it('clé API invalide → 403', async () => {
    const res = await POST(req({ token: 'GF2.x' }, 'mauvaise-cle-0123456789') as never)
    expect(res.status).toBe(403)
  })

  it('token manquant → 400', async () => {
    const res = await POST(req({}) as never)
    expect(res.status).toBe(400)
  })

  it('token invalide (signature) → 400', async () => {
    vState.result = { valid: false, reason: 'Licence invalide ou modifiée' }
    const res = await POST(req({ token: 'GF2.bad' }) as never)
    expect(res.status).toBe(400)
  })

  it('clé mécanicien, parent PRÉSENT → parentLicenseId posé + mechanicHint', async () => {
    vState.result = { valid: true, payload: mechPayload, isAdmin: false, isMechanic: true }
    dbState.parents = new Set(['L-garage'])
    const res = await POST(req({ token: 'GF2.mech' }) as never)
    expect(res.status).toBe(201)
    expect(dbState.created?.parentLicenseId).toBe('L-garage')
    expect(dbState.created?.mechanicHint).toBe('Alice')
  })

  it('clé mécanicien, parent ABSENT → parentLicenseId null (FK-safe)', async () => {
    vState.result = { valid: true, payload: mechPayload, isAdmin: false, isMechanic: true }
    dbState.parents = new Set()
    const res = await POST(req({ token: 'GF2.mech' }) as never)
    expect(res.status).toBe(201)
    expect(dbState.created?.parentLicenseId).toBe(null)
  })

  it('fail_closed (Upstash indispo) + clé valide → NON bloqué (201)', async () => {
    rlState.result = { ok: false, degraded: 'fail_closed', retryAfterSec: 60 }
    const res = await POST(req({ token: 'GF2.x' }) as never)
    expect(res.status).toBe(201)
  })

  it('vraie limite atteinte (429) → bloqué', async () => {
    rlState.result = { ok: false, retryAfterSec: 30 }
    const res = await POST(req({ token: 'GF2.x' }) as never)
    expect(res.status).toBe(429)
  })

  it('course à l\'insertion (P2002) → 409', async () => {
    dbState.createThrows = { code: 'P2002' }
    const res = await POST(req({ token: 'GF2.x' }) as never)
    expect(res.status).toBe(409)
  })
})
