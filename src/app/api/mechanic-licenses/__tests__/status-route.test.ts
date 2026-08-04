/**
 * /api/mechanic-licenses/[lid]/status — corrections §2 (révocation irréversible)
 * et §6 (audit acteur/cible, jamais de mechanicId='').
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.GF_DB_MAC_SECRET = 'test-mac-secret'

const state = vi.hoisted(() => ({
  license: null as Record<string, unknown> | null,
  audits: [] as Record<string, unknown>[],
  updated: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findFirst: async () => state.license,
      update: async (args: { data: Record<string, unknown> }) => { state.updated = args.data; return args.data },
    },
    licenseDevice: { updateMany: async () => ({ count: 0 }) },
    mechanicActionAudit: { create: async (args: { data: Record<string, unknown> }) => { state.audits.push(args.data); return args.data } },
  },
}))
vi.mock('@/lib/api-helpers', () => ({
  requireSession: async () => ({ user: { id: 'owner1', role: 'OWNER', garageId: 'gA' } }),
  withAuth: (h: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => {
      try { return await h(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e }
    },
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

import { POST } from '@/app/api/mechanic-licenses/[lid]/status/route'

function req(status: string): Request {
  return new Request('http://127.0.0.1/api/mechanic-licenses/L1/status', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
  })
}
function call(status: string) {
  return (POST as unknown as (r: Request, c: { params: { lid: string } }) => Promise<Response>)(req(status), { params: { lid: 'L1' } })
}
function baseLicense(over: Record<string, unknown> = {}) {
  return {
    id: 1, licenseId: 'L1', token: 'tok', status: 'active',
    expiryAt: new Date('2030-01-01T00:00:00Z'), hwid: null,
    parentLicenseId: 'P1', mechanicId: 'M1', revokedAt: null, suspendedAt: null, ...over,
  }
}

beforeEach(() => { state.license = null; state.audits = []; state.updated = null })

describe('§2 — révocation irréversible', () => {
  it('revoked → active : REFUSÉ (409)', async () => {
    state.license = baseLicense({ status: 'revoked', revokedAt: new Date() })
    expect((await call('active')).status).toBe(409)
    expect(state.updated).toBeNull() // aucune écriture
  })
  it('revoked → suspended : REFUSÉ (409)', async () => {
    state.license = baseLicense({ status: 'revoked', revokedAt: new Date() })
    expect((await call('suspended')).status).toBe(409)
  })
  it('révocation détectée aussi via revokedAt même si status incohérent', async () => {
    state.license = baseLicense({ status: 'active', revokedAt: new Date() })
    expect((await call('active')).status).toBe(409)
  })
  it('active → suspended : autorisé (200)', async () => {
    state.license = baseLicense()
    expect((await call('suspended')).status).toBe(200)
  })
  it('active → revoked : autorisé (200)', async () => {
    state.license = baseLicense()
    expect((await call('revoked')).status).toBe(200)
  })
})

describe('§6 — audit acteur/cible (jamais de chaîne vide)', () => {
  it('action staff → actorUserId/actorRole renseignés, targetMechanicId = mécanicien de la clé', async () => {
    state.license = baseLicense({ mechanicId: 'M1' })
    await call('suspended')
    const a = state.audits.at(-1)!
    expect(a.actorUserId).toBe('owner1')
    expect(a.actorRole).toBe('OWNER')
    expect(a.targetMechanicId).toBe('M1')
    expect(a.action).toBe('suspend')
    expect('mechanicId' in a).toBe(false) // l'ancienne colonne n'est plus écrite
  })
  it('clé non attribuée → targetMechanicId = null (jamais "")', async () => {
    state.license = baseLicense({ mechanicId: null })
    await call('revoked')
    const a = state.audits.at(-1)!
    expect(a.targetMechanicId).toBeNull()
    expect(a.targetMechanicId).not.toBe('')
  })
})
