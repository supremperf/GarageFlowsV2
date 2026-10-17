/**
 * POST /api/sync/mechanic-status — propagation POSTE → CLOUD du statut.
 *
 * TEST D (volet retrait) : une clé révoquée sur le poste doit l'être aussi côté
 * cloud, sinon le mécanicien écarté garde l'accès depuis son téléphone.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

process.env.GF_DB_MAC_SECRET = 'test-mac-secret-status-sync'

const GARAGE_LID = 'garage-lid-1'
const MECH_LID = 'mech-lid-1'

const cap = vi.hoisted(() => ({
  licenses: new Map<string, Record<string, unknown>>(),
  devices: [] as Array<Record<string, unknown>>,
  tokens: new Map<string, Record<string, unknown>>(),
}))

// Cette suite isole l'orchestration/tenant ; intégrité réelle testée dans incident-record-integrity.test.ts.
vi.mock('@/lib/license/record-mac', async (original) => ({
  ...await original<typeof import('@/lib/license/record-mac')>(),
  verifyRecordMac: () => ({ ok: true, tampered: false, missing: false }),
}))

vi.mock('@/lib/db', () => {
  const tx = {
    licenseKey: {
      findUnique: async (a: { where: { licenseId: string } }) => cap.licenses.get(a.where.licenseId) ?? null,
      update: async (a: { where: { licenseId: string }; data: Record<string, unknown> }) => {
        const row = cap.licenses.get(a.where.licenseId)!
        Object.assign(row, a.data); return row
      },
    },
    licenseDevice: {
      updateMany: async (a: { data: Record<string, unknown> }) => { cap.devices.push(a.data); return { count: 1 } },
    },
  }
  return {
    prisma: {
      licenseKey: { findUnique: async (a: { where: { licenseId: string } }) => cap.licenses.get(a.where.licenseId) ?? null },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
    isPostgresDatabase: () => true,
  }
})
vi.mock('@/lib/security/rate-limit', () => ({
  clientIpFrom: () => '127.0.0.1',
  enforceRateLimit: async () => ({ ok: true }),
  rateLimitResponse: () => new Response('rate', { status: 429 }),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('@/lib/license/verify', () => ({
  verifyLicenseToken: (token: string) => cap.tokens.get(token) ?? { valid: false, reason: 'inconnu' },
}))

let POST: (req: Request) => Promise<Response>
beforeAll(async () => { POST = (await import('../mechanic-status/route')).POST as never })

const call = (status: string, over: Record<string, unknown> = {}) =>
  POST(new Request('http://x/api/sync/mechanic-status', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ garageLicense: 'GF2.garage', mechanicLicense: 'GF2.mech', status, ...over }),
  }))

beforeEach(() => {
  cap.licenses.clear(); cap.devices = []; cap.tokens.clear()
  cap.tokens.set('GF2.garage', { valid: true, isMechanic: false, payload: { lid: GARAGE_LID, typ: 'premium', exp: Math.floor(Date.now() / 1000) + 86_400 } })
  cap.tokens.set('GF2.mech', { valid: true, isMechanic: true, payload: { lid: MECH_LID, typ: 'mechanic', plid: GARAGE_LID, exp: Math.floor(Date.now() / 1000) + 86_400 } })
  cap.licenses.set(GARAGE_LID, { licenseId: GARAGE_LID, licenseType: 'premium', status: 'active', garageId: 'gA', expiryAt: new Date(Date.now() + 86_400_000), revokedAt: null })
  cap.licenses.set(MECH_LID, {
    licenseId: MECH_LID, licenseType: 'mechanic', status: 'active', token: 'GF2.mech',
    expiryAt: new Date(Date.now() + 86_400_000), hwid: null, parentLicenseId: GARAGE_LID,
    mechanicId: 'm1', recordMac: 'stale', revokedAt: null, suspendedAt: null,
  })
})

describe('propagation du statut vers le cloud', () => {
  it('révocation appliquée + appareils coupés + MAC recalculé', async () => {
    const res = await call('revoked')
    expect(res.status).toBe(200)
    const row = cap.licenses.get(MECH_LID)!
    expect(row.status).toBe('revoked')
    expect(row.revokedAt).toBeTruthy()
    expect(row.recordMac).not.toBe('stale')
    expect(cap.devices[0]).toMatchObject({ status: 'revoked' })
  })

  it('suspension : appareils déconnectés (siège libéré, pas de révocation)', async () => {
    const res = await call('suspended')
    expect(res.status).toBe(200)
    expect(cap.licenses.get(MECH_LID)!.status).toBe('suspended')
    expect(cap.devices[0]).toMatchObject({ status: 'deactivated' })
  })

  it('réactivation possible depuis suspendu', async () => {
    await call('suspended')
    const res = await call('active')
    expect(res.status).toBe(200)
    expect(cap.licenses.get(MECH_LID)!.status).toBe('active')
    expect(cap.licenses.get(MECH_LID)!.suspendedAt).toBeNull()
  })

  it('une clé RÉVOQUÉE ne se réactive jamais', async () => {
    await call('revoked')
    const res = await call('active')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('REVOKED_IS_FINAL')
    expect(cap.licenses.get(MECH_LID)!.status).toBe('revoked')
  })

  it('statut inconnu refusé', async () => {
    expect((await call('n-importe-quoi')).status).toBe(400)
  })

  it('clé d’un autre garage refusée', async () => {
    cap.tokens.set('GF2.mech', { valid: true, isMechanic: true, payload: { lid: MECH_LID, typ: 'mechanic', plid: 'autre-parent', exp: Math.floor(Date.now() / 1000) + 86_400 } })
    const res = await call('revoked')
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PARENT_MISMATCH')
    expect(cap.licenses.get(MECH_LID)!.status).toBe('active')
  })

  it('licence garage révoquée : aucune écriture', async () => {
    cap.licenses.get(GARAGE_LID)!.status = 'revoked'
    const res = await call('revoked')
    expect(res.status).toBe(403)
    expect(cap.licenses.get(MECH_LID)!.status).toBe('active')
  })
})
