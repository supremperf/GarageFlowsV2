/**
 * POST /api/sync/mechanic-assignment — remontée POSTE → CLOUD (P0).
 *
 * Couvre les cas exigés : attribution reçue et écrite (TEST A), ré-envoi sans
 * doublon (TEST B), clé d'un autre garage refusée (TEST C), licence révoquée
 * refusée (TEST D), mécanicien rattaché à un autre garage (TEST E).
 *
 * Couche base simulée (convention du dépôt, cf. mechanic-licenses/__tests__).
 * La chaîne complète est rejouée en conditions réelles contre
 * app.garageflows.fr après déploiement.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

process.env.GF_DB_MAC_SECRET = 'test-mac-secret-sync'

const GARAGE_LID = 'garage-lid-1'
const MECH_LID   = 'mech-lid-1'
const GARAGE_ID  = 'gA'
const MECH_ID    = 'm1'

const cap = vi.hoisted(() => ({
  licenses: new Map<string, Record<string, unknown>>(),
  garages: new Map<string, Record<string, unknown>>(),
  mechanics: new Map<string, Record<string, unknown>>(),
  assignments: [] as Array<Record<string, unknown>>,
  tokens: new Map<string, Record<string, unknown>>(),
}))

vi.mock('@/lib/db', () => {
  const tx = {
    licenseKey: {
      findUnique: async (a: { where: { licenseId: string } }) => cap.licenses.get(a.where.licenseId) ?? null,
      updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = cap.licenses.get(String(a.where.licenseId))
        if (!row || (a.where.garageId === null && row.garageId != null)) return { count: 0 }
        Object.assign(row, a.data); return { count: 1 }
      },
      update: async (a: { where: { licenseId: string }; data: Record<string, unknown> }) => {
        const row = cap.licenses.get(a.where.licenseId)!
        Object.assign(row, a.data); return row
      },
    },
    garage: {
      findUnique: async (a: { where: { id: string } }) => cap.garages.get(a.where.id) ?? null,
      create: async (a: { data: Record<string, unknown> }) => { cap.garages.set(String(a.data.id), a.data); return a.data },
    },
    mechanic: {
      findUnique: async (a: { where: { id: string } }) => cap.mechanics.get(a.where.id) ?? null,
      create: async (a: { data: Record<string, unknown> }) => { cap.mechanics.set(String(a.data.id), a.data); return a.data },
    },
    mechanicLicenseAssignment: {
      findFirst: async (a: { where: Record<string, unknown> }) =>
        cap.assignments.find(x => x.licenseId === a.where.licenseId && x.mechanicId === a.where.mechanicId && x.unassignedAt == null) ?? null,
      create: async (a: { data: Record<string, unknown> }) => {
        const row = { ...a.data, unassignedAt: null }; cap.assignments.push(row); return row
      },
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
beforeAll(async () => { POST = (await import('../mechanic-assignment/route')).POST as never })

function post(body: unknown) {
  return new Request('http://x/api/sync/mechanic-assignment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

const validBody = (over: Record<string, unknown> = {}) => ({
  garageLicense: 'GF2.garage',
  mechanicLicense: 'GF2.mech',
  garage: { id: GARAGE_ID, name: 'Garage Test' },
  mechanic: { id: MECH_ID, name: 'Alice', avatar: 'AL', color: '#3b82f6' },
  ...over,
})

beforeEach(() => {
  cap.licenses.clear(); cap.garages.clear(); cap.mechanics.clear(); cap.assignments = []; cap.tokens.clear()

  cap.tokens.set('GF2.garage', {
    valid: true, isMechanic: false,
    payload: { lid: GARAGE_LID, typ: 'premium', exp: Math.floor(Date.now() / 1000) + 86_400 },
  })
  cap.tokens.set('GF2.mech', {
    valid: true, isMechanic: true,
    payload: { lid: MECH_LID, typ: 'mechanic', plid: GARAGE_LID, mn: 'Alice', exp: Math.floor(Date.now() / 1000) + 86_400 },
  })

  cap.licenses.set(GARAGE_LID, {
    licenseId: GARAGE_LID, licenseType: 'premium', status: 'active', garageId: null,
    expiryAt: new Date(Date.now() + 86_400_000), revokedAt: null, token: 'GF2.garage', hwid: null,
  })
  cap.licenses.set(MECH_LID, {
    licenseId: MECH_LID, licenseType: 'mechanic', status: 'active', garageId: null, mechanicId: null,
    parentLicenseId: null, mechanicHint: null, recordMac: 'stale', assignedAt: null,
    expiryAt: new Date(Date.now() + 86_400_000), revokedAt: null, token: 'GF2.mech', hwid: null,
  })
})

describe('TEST A — le cloud reçoit et écrit l’attribution faite sur le poste', () => {
  it('crée le miroir garage + mécanicien et lie la clé', async () => {
    const res = await POST(post(validBody()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.idempotent).toBe(false)

    // Ce que l'activation PWA exige, désormais présent :
    const key = cap.licenses.get(MECH_LID)!
    expect(key.garageId).toBe(GARAGE_ID)
    expect(key.mechanicId).toBe(MECH_ID)
    expect(key.parentLicenseId).toBe(GARAGE_LID)
    expect(key.recordMac).not.toBe('stale')
    expect(cap.garages.get(GARAGE_ID)).toBeTruthy()
    expect(cap.mechanics.get(MECH_ID)).toMatchObject({ garageId: GARAGE_ID, name: 'Alice' })
    // Rattachement de la licence garage à la première utilisation.
    expect(cap.licenses.get(GARAGE_LID)!.garageId).toBe(GARAGE_ID)
    expect(cap.assignments).toHaveLength(1)
  })

  it('ne synchronise que l’identité — aucune donnée métier', async () => {
    await POST(post(validBody()))
    expect(Object.keys(cap.garages.get(GARAGE_ID)!).sort()).toEqual(['id', 'name', 'slug'])
    expect(Object.keys(cap.mechanics.get(MECH_ID)!).sort()).toEqual(['avatar', 'color', 'garageId', 'id', 'name'])
  })
})

describe('TEST B — ré-envoi idempotent', () => {
  it('deux appels identiques ne créent qu’une attribution', async () => {
    await POST(post(validBody()))
    const res2 = await POST(post(validBody()))
    expect(res2.status).toBe(200)
    expect((await res2.json()).idempotent).toBe(true)
    expect(cap.assignments).toHaveLength(1)
    expect(cap.garages.size).toBe(1)
    expect(cap.mechanics.size).toBe(1)
  })
})

describe('TEST C — clé mécanicien d’un autre garage', () => {
  it('refuse si le plid signé ne désigne pas la licence présentée', async () => {
    cap.tokens.set('GF2.mech', {
      valid: true, isMechanic: true,
      payload: { lid: MECH_LID, typ: 'mechanic', plid: 'autre-garage-lid', exp: Math.floor(Date.now() / 1000) + 86_400 },
    })
    const res = await POST(post(validBody()))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PARENT_MISMATCH')
    expect(cap.licenses.get(MECH_LID)!.mechanicId).toBeNull()
  })

  it('refuse si la ligne serveur appartient déjà à un autre garage', async () => {
    cap.licenses.get(MECH_LID)!.garageId = 'gB'
    const res = await POST(post(validBody()))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('MECHANIC_KEY_FOREIGN_GARAGE')
  })

  it('refuse une licence garage inconnue du serveur', async () => {
    cap.licenses.delete(GARAGE_LID)
    const res = await POST(post(validBody()))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('LICENSE_UNKNOWN')
  })

  it('refuse une clé MÉCANICIEN présentée comme licence garage', async () => {
    const res = await POST(post(validBody({ garageLicense: 'GF2.mech' })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('NOT_A_GARAGE_LICENSE')
  })
})

describe('TEST D — licences révoquées / expirées', () => {
  it('licence garage révoquée → refus', async () => {
    cap.licenses.get(GARAGE_LID)!.status = 'revoked'
    const res = await POST(post(validBody()))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('LICENSE_REVOKED')
  })

  it('licence garage expirée → refus', async () => {
    cap.licenses.get(GARAGE_LID)!.expiryAt = new Date(Date.now() - 1000)
    const res = await POST(post(validBody()))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('LICENSE_EXPIRED')
  })

  it('clé mécanicien révoquée → refus, aucune écriture', async () => {
    cap.licenses.get(MECH_LID)!.status = 'revoked'
    const res = await POST(post(validBody()))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('MECHANIC_KEY_REVOKED')
    expect(cap.licenses.get(MECH_LID)!.mechanicId).toBeNull()
  })

  it('jeton mécanicien altéré → refus', async () => {
    cap.tokens.set('GF2.mech', { valid: false, reason: 'Licence invalide ou modifiée' })
    const res = await POST(post(validBody()))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('MECHANIC_LICENSE_INVALID')
  })
})

describe('TEST E — attribution existante et mécanicien étranger', () => {
  it('n’écrase JAMAIS une attribution vers un autre mécanicien', async () => {
    cap.licenses.get(MECH_LID)!.mechanicId = 'autre-mecanicien'
    cap.licenses.get(MECH_LID)!.garageId = GARAGE_ID
    const res = await POST(post(validBody()))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ALREADY_ASSIGNED')
    expect(cap.licenses.get(MECH_LID)!.mechanicId).toBe('autre-mecanicien')
  })

  it('refuse de déplacer un mécanicien existant vers un autre garage', async () => {
    cap.mechanics.set(MECH_ID, { id: MECH_ID, name: 'Alice', garageId: 'gB' })
    const res = await POST(post(validBody()))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('MECHANIC_FOREIGN_GARAGE')
    expect(cap.mechanics.get(MECH_ID)!.garageId).toBe('gB')
  })

  it('clé mécanicien absente du serveur → conflit explicite', async () => {
    cap.licenses.delete(MECH_LID)
    const res = await POST(post(validBody()))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('MECHANIC_KEY_UNKNOWN')
  })
})
