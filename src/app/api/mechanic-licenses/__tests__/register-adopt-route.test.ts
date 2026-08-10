/**
 * Enregistrement d'une clé mécanicien DÉJÀ PRÉSENTE en base (P0 « clé refusée »).
 *
 * Contexte réel (production, 2026-08-09) : le keygen pousse chaque clé au serveur
 * via /api/admin/licenses/create. La ligne LicenseKey existe donc AVANT que le
 * patron ne colle la clé dans « Paramètres › Accès mécaniciens », avec
 * garageId = NULL (et parentLicenseId = NULL quand la licence garage a été
 * enregistrée APRÈS la clé mécanicien). L'ancienne route répondait
 * « Cette clé est déjà enregistrée » (409) : la clé n'apparaissait jamais dans la
 * liste du patron (filtrée par garageId), ne pouvait pas être attribuée, et
 * l'activation renvoyait MECHANIC_KEY_UNASSIGNED.
 *
 * Ce test couvre la LOGIQUE DE ROUTE (couche base simulée, convention du dépôt —
 * cf. assign-route.test.ts). La chaîne complète a par ailleurs été rejouée en
 * conditions réelles sur l'application packagée et sur app.garageflows.fr.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

process.env.GF_DB_MAC_SECRET = 'test-mac-secret-adopt'

const LID    = 'mech-lid-1'
const PLID   = 'garage-lid-1'
const GARAGE = 'gA'

const cap = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  updateManyCalls: [] as Array<Record<string, unknown>>,
  bindCalls: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
  count: 0,
}))

vi.mock('@/lib/db', () => {
  const tx = {
    licenseKey: {
      count: async () => cap.count,
      updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        cap.updateManyCalls.push(a)
        const row = cap.rows.get(String(a.where.licenseId))
        // Respecte la garde de concurrence : la ligne doit être encore libre.
        if (!row || row.garageId != null || row.mechanicId != null) return { count: 0 }
        Object.assign(row, a.data)
        return { count: 1 }
      },
      findUnique: async (a: { where: { licenseId: string } }) => cap.rows.get(a.where.licenseId) ?? null,
      create: async (a: { data: Record<string, unknown> }) => { cap.created.push(a.data); return a.data },
    },
  }
  return {
    prisma: {
      licenseKey: {
        findUnique: async (a: { where: { licenseId: string } }) => cap.rows.get(a.where.licenseId) ?? null,
        updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          cap.bindCalls.push(a)
          const row = cap.rows.get(String(a.where.licenseId))
          if (!row || row.garageId != null) return { count: 0 }
          Object.assign(row, a.data)
          return { count: 1 }
        },
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
    isPostgresDatabase: () => false,
  }
})
vi.mock('@/lib/api-helpers', () => ({
  requireSession: async () => ({ user: { id: 'owner1', role: 'OWNER', garageId: GARAGE } }),
  withAuth: (h: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => {
      try { return await h(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e }
    },
}))
vi.mock('@/lib/authz', () => ({ can: () => true }))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))
vi.mock('@/lib/license/verify', () => ({
  verifyLicenseToken: (token: string) => ({
    valid: true,
    isMechanic: true,
    payload: { lid: LID, cid: 'cust', plid: PLID, exp: Math.floor(Date.now() / 1000) + 86_400, mn: 'Alice' },
  }),
}))

let POST: (req: unknown, ctx: unknown) => Promise<Response>
beforeAll(async () => { POST = (await import('../route')).POST as never })

function req(token: string) {
  return new Request('http://x/api/mechanic-licenses', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  })
}

function seedParent(garageId: string | null = GARAGE) {
  cap.rows.set(PLID, {
    licenseId: PLID, licenseType: 'premium', status: 'active', garageId,
    expiryAt: new Date(Date.now() + 86_400_000), hwid: null, mechanicId: null, parentLicenseId: null,
  })
}

function seedOrphanMechanicKey(over: Record<string, unknown> = {}) {
  cap.rows.set(LID, {
    licenseId: LID, licenseType: 'mechanic', status: 'active', token: 'GF2.old',
    expiryAt: new Date(Date.now() + 86_400_000), hwid: null,
    garageId: null, mechanicId: null, parentLicenseId: null, mechanicHint: null, recordMac: 'stale',
    createdAt: new Date(), ...over,
  })
}

beforeEach(() => {
  cap.rows.clear(); cap.updateManyCalls = []; cap.bindCalls = []; cap.created = []; cap.count = 0
})

describe('POST /api/mechanic-licenses — clé pré-enregistrée par le keygen', () => {
  it('adopte une clé orpheline : garageId + parentLicenseId posés, MAC recalculé', async () => {
    seedParent()
    seedOrphanMechanicKey()

    const res = await POST(req('GF2.new') as never, {} as never) as Response
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.adopted).toBe(true)
    expect(body.assigned).toBe(false)

    const row = cap.rows.get(LID)!
    expect(row.garageId).toBe(GARAGE)
    expect(row.parentLicenseId).toBe(PLID)
    expect(row.token).toBe('GF2.new')          // le jeton vérifié fait foi
    expect(row.mechanicHint).toBe('Alice')
    expect(row.recordMac).not.toBe('stale')    // parentLicenseId entre dans le MAC
    expect(String(row.recordMac)).toMatch(/^[0-9a-f]{16,}$/)
    expect(cap.created).toHaveLength(0)        // adoption, pas création
  })

  it('rattache au passage la licence garage parente encore libre', async () => {
    seedParent(null)
    seedOrphanMechanicKey()

    const res = await POST(req('GF2.new') as never, {} as never) as Response
    expect(res.status).toBe(200)
    expect(cap.rows.get(PLID)!.garageId).toBe(GARAGE)
  })

  it('refuse une clé appartenant à un AUTRE garage (message neutre)', async () => {
    seedParent()
    seedOrphanMechanicKey({ garageId: 'gB' })

    const res = await POST(req('GF2.new') as never, {} as never) as Response
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Cette clé est déjà enregistrée.')
    expect(cap.rows.get(LID)!.garageId).toBe('gB')   // inchangée
  })

  it('refuse une clé déjà attribuée à un mécanicien', async () => {
    seedParent()
    seedOrphanMechanicKey({ mechanicId: 'mech-9' })

    const res = await POST(req('GF2.new') as never, {} as never) as Response
    expect(res.status).toBe(409)
  })

  it('refuse si la licence garage parente n’appartient pas à ce garage', async () => {
    seedParent('gB')
    seedOrphanMechanicKey()

    const res = await POST(req('GF2.new') as never, {} as never) as Response
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/parente introuvable/)
    expect(cap.rows.get(LID)!.garageId).toBeNull()
  })

  it('respecte le plafond de clés mécanicien lors de l’adoption', async () => {
    seedParent()
    seedOrphanMechanicKey()
    process.env.GF_MAX_MECHANIC_KEYS = '2'
    cap.count = 2

    const res = await POST(req('GF2.new') as never, {} as never) as Response
    expect(res.status).toBe(403)
    expect(cap.rows.get(LID)!.garageId).toBeNull()
    delete process.env.GF_MAX_MECHANIC_KEYS
  })
})
