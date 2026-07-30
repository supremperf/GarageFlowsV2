/**
 * Table de vérité HWID au niveau de la ROUTE /api/license/activate.
 *
 * La vérification cryptographique du token (ECDSA) est testée séparément dans
 * verify.test.ts et nécessite la clé privée (absente du dépôt). Ici on isole la
 * logique d'orchestration DB + HWID de la route : on stube verifyLicenseToken
 * (couche crypto) mais on utilise le VRAI verifyHwid/isValidHwidFormat.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Secret fort requis par getAuthSecret() (pas de repli en dur).
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

const BOUND_HWID = 'a'.repeat(64)
const OTHER_HWID = 'b'.repeat(64)

// ── Mock Prisma ────────────────────────────────────────────────────────────────
// vi.mock est hissé en tête de module : tout l'état du mock doit l'être aussi.
const { licenseKey, deviceStore, prismaMock } = vi.hoisted(() => {
  const licenseKey = {
    record: null as Record<string, unknown> | null,
    findUnique: vi.fn(async () => licenseKey.record),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
  }

  // Magasin d'appareils en mémoire — supporte le flux d'activation atomique
  // (le callback $transaction reçoit le même double, comme le vrai client).
  type DeviceRow = {
    id: string
    deviceId: string
    licenseId: string
    hwidHash: string
    tokenHash: string
    status: string
  }
  const deviceStore: { rows: DeviceRow[]; seq: number } = { rows: [], seq: 0 }

  const licenseDevice = {
    findUnique: async ({ where }: { where: Record<string, unknown> }) => {
      if (where.licenseId_hwidHash) {
        const w = where.licenseId_hwidHash as { licenseId: string; hwidHash: string }
        return deviceStore.rows.find((r) => r.licenseId === w.licenseId && r.hwidHash === w.hwidHash) ?? null
      }
      if (where.tokenHash) return deviceStore.rows.find((r) => r.tokenHash === where.tokenHash) ?? null
      if (where.deviceId) return deviceStore.rows.find((r) => r.deviceId === where.deviceId) ?? null
      return null
    },
    count: async ({ where }: { where: { licenseId: string; status?: string } }) =>
      deviceStore.rows.filter((r) => r.licenseId === where.licenseId && (!where.status || r.status === where.status)).length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: DeviceRow = {
        id: `d${++deviceStore.seq}`,
        deviceId: `dev-${deviceStore.seq}`,
        licenseId: String(data.licenseId),
        hwidHash: String(data.hwidHash),
        tokenHash: String(data.tokenHash),
        status: String(data.status ?? 'active'),
      }
      deviceStore.rows.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = deviceStore.rows.find((r) => r.id === where.id)
      if (row) Object.assign(row, data)
      return row
    },
  }

  const prismaMock = {
    licenseKey: {
      findUnique: () => licenseKey.findUnique(),
      update: () => licenseKey.update(),
      create: () => licenseKey.create(),
    },
    licenseDevice,
    licenseDeviceEvent: { create: async () => ({}) },
    $executeRaw: async () => 0,
    $transaction: async (arg: unknown) => {
      if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)(prismaMock)
      return Promise.all(arg as Promise<unknown>[])
    },
  }

  return { licenseKey, deviceStore, prismaMock }
})

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
  isPostgresDatabase: () => false,
}))

// Rate-limit toujours passant (la couche réelle est testée dans security-rate-limit.test.ts).
vi.mock('@/lib/security/rate-limit', () => ({
  clientIpFrom: () => 'local',
  enforceRateLimit: async () => ({ ok: true, remaining: 99 }),
  rateLimitResponse: () => {
    throw new Error('rateLimitResponse ne doit pas être appelé dans ces tests')
  },
}))

// Intégrité MAC toujours OK.
vi.mock('@/lib/license/record-mac', () => ({
  verifyRecordMac: () => ({ tampered: false, missing: false }),
  computeRecordMac: () => 'mac',
}))

// Couche crypto stubée — garde le VRAI verifyHwid/isValidHwidFormat.
const verifyMock = vi.hoisted(() => ({ payload: null as Record<string, unknown> | null }))
vi.mock('@/lib/license/verify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../license/verify')>()
  return {
    ...actual,
    verifyLicenseToken: () => ({
      valid: true,
      payload: verifyMock.payload,
      isAdmin: verifyMock.payload?.typ === 'admin',
    }),
  }
})

import { POST } from '@/app/api/license/activate/route'

function req(body: unknown): Request {
  return new Request('http://127.0.0.1/api/license/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const basePayload = {
  lid: 'lid-1', cid: 'cid-1', typ: 'premium',
  iss: 1_700_000_000, exp: 4_100_000_000, seats: 1, wm: 'x', ver: '2.0',
}

beforeEach(() => {
  licenseKey.record = null
  verifyMock.payload = { ...basePayload }
  deviceStore.rows = []
  deviceStore.seq = 0
  vi.clearAllMocks()
})

describe('POST /api/license/activate — table de vérité HWID (licence LIÉE)', () => {
  beforeEach(() => {
    // Record existant lié à un matériel.
    licenseKey.record = {
      id: 1, licenseId: 'lid-1', status: 'active', hwid: BOUND_HWID,
      token: 't', expiryAt: new Date(9_999_999_999_000),
    }
  })

  it('HWID absent → refus (403)', async () => {
    const res = await POST(req({ license: 'GF2.x.y.z' }) as never)
    expect(res.status).toBe(403)
    expect((await res.json()).ok).toBe(false)
  })

  it('HWID vide → refus (403)', async () => {
    const res = await POST(req({ license: 'GF2.x.y.z', hwid: '' }) as never)
    expect(res.status).toBe(403)
  })

  it('HWID mal formé → refus (403)', async () => {
    const res = await POST(req({ license: 'GF2.x.y.z', hwid: 'pas-un-hash' }) as never)
    expect(res.status).toBe(403)
  })

  it('HWID différent → refus (403)', async () => {
    const res = await POST(req({ license: 'GF2.x.y.z', hwid: OTHER_HWID }) as never)
    expect(res.status).toBe(403)
  })

  it('HWID identique → autorisé (200)', async () => {
    const res = await POST(req({ license: 'GF2.x.y.z', hwid: BOUND_HWID }) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(licenseKey.update).toHaveBeenCalled()
  })
})

describe('POST /api/license/activate — révocation / suspension / première utilisation', () => {
  it('licence révoquée → refus', async () => {
    licenseKey.record = { id: 1, licenseId: 'lid-1', status: 'revoked', hwid: null }
    const res = await POST(req({ license: 'GF2.x.y.z' }) as never)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.reason).toMatch(/révoqu/i)
  })

  it('licence suspendue → refus', async () => {
    licenseKey.record = { id: 1, licenseId: 'lid-1', status: 'suspended', hwid: null }
    const res = await POST(req({ license: 'GF2.x.y.z' }) as never)
    expect((await res.json()).ok).toBe(false)
  })

  it('première utilisation, token lié au matériel + machine conforme → enregistré', async () => {
    licenseKey.record = null
    verifyMock.payload = { ...basePayload, hwid: BOUND_HWID }
    const res = await POST(req({ license: 'GF2.x.y.z', hwid: BOUND_HWID }) as never)
    expect(res.status).toBe(200)
    expect(licenseKey.create).toHaveBeenCalled()
  })

  it('première utilisation, token lié au matériel + machine NON conforme → refus (403)', async () => {
    licenseKey.record = null
    verifyMock.payload = { ...basePayload, hwid: BOUND_HWID }
    const res = await POST(req({ license: 'GF2.x.y.z', hwid: OTHER_HWID }) as never)
    expect(res.status).toBe(403)
    expect(licenseKey.create).not.toHaveBeenCalled()
  })

  it('première utilisation, token lié au matériel + HWID absent → refus (403)', async () => {
    licenseKey.record = null
    verifyMock.payload = { ...basePayload, hwid: BOUND_HWID }
    const res = await POST(req({ license: 'GF2.x.y.z' }) as never)
    expect(res.status).toBe(403)
    expect(licenseKey.create).not.toHaveBeenCalled()
  })

  it('licence sans HWID initial → activation autorisée', async () => {
    licenseKey.record = null
    verifyMock.payload = { ...basePayload }   // pas de hwid dans le token
    const res = await POST(req({ license: 'GF2.x.y.z' }) as never)
    expect(res.status).toBe(200)
    expect(licenseKey.create).toHaveBeenCalled()
  })

  it('licence expirée en base → refus même si le token semble valide', async () => {
    licenseKey.record = {
      id: 1, licenseId: 'lid-1', status: 'active', hwid: null,
      token: 't', expiryAt: new Date(Date.now() - 1000), seats: 1,
    }
    const res = await POST(req({ license: 'GF2.x.y.z' }) as never)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.code).toBe('LICENSE_EXPIRED')
  })
})

describe('POST /api/license/activate — appareils (deviceToken, plafond de sièges)', () => {
  const HWID_A = 'c'.repeat(64)
  const HWID_B = 'd'.repeat(64)

  it('activation avec HWID → deviceToken (256 bits) et deviceId retournés', async () => {
    const res = await POST(req({ license: 'GF2.x.y.z', hwid: HWID_A, os: 'win32', version: '1.1.0' }) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.deviceToken).toBe('string')
    // 32 octets CSPRNG → 43 caractères base64url
    expect(body.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(typeof body.deviceId).toBe('string')
    // Le jeton n'est JAMAIS stocké en clair — seul son HMAC est persisté.
    expect(deviceStore.rows).toHaveLength(1)
    expect(deviceStore.rows[0].tokenHash).not.toBe(body.deviceToken)
    expect(deviceStore.rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/)
    // Le HWID brut n'est pas persisté non plus.
    expect(deviceStore.rows[0].hwidHash).not.toBe(HWID_A)
  })

  it('réactivation même HWID → même appareil, jeton tourné (pas de 2e siège)', async () => {
    const res1 = await POST(req({ license: 'GF2.x.y.z', hwid: HWID_A }) as never)
    const tok1 = (await res1.json()).deviceToken
    const res2 = await POST(req({ license: 'GF2.x.y.z', hwid: HWID_A }) as never)
    const body2 = await res2.json()
    expect(res2.status).toBe(200)
    expect(body2.deviceToken).not.toBe(tok1) // rotation
    expect(deviceStore.rows).toHaveLength(1) // toujours un seul appareil
  })

  it('seats=1 : second appareil (HWID différent) → 403 DEVICE_LIMIT_REACHED', async () => {
    await POST(req({ license: 'GF2.x.y.z', hwid: HWID_A }) as never)
    const res = await POST(req({ license: 'GF2.x.y.z', hwid: HWID_B }) as never)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.code).toBe('DEVICE_LIMIT_REACHED')
    expect(deviceStore.rows).toHaveLength(1)
  })

  it('seats=2 : deux appareils acceptés, le troisième refusé', async () => {
    verifyMock.payload = { ...basePayload, seats: 2 }
    expect((await POST(req({ license: 'GF2.x.y.z', hwid: HWID_A }) as never)).status).toBe(200)
    licenseKey.record = {
      id: 1, licenseId: 'lid-1', status: 'active', hwid: null,
      token: 't', expiryAt: new Date(9_999_999_999_000), seats: 2,
    }
    expect((await POST(req({ license: 'GF2.x.y.z', hwid: HWID_B }) as never)).status).toBe(200)
    const res3 = await POST(req({ license: 'GF2.x.y.z', hwid: 'e'.repeat(64) }) as never)
    expect(res3.status).toBe(403)
    expect((await res3.json()).code).toBe('DEVICE_LIMIT_REACHED')
    expect(deviceStore.rows).toHaveLength(2)
  })

  it('appareil révoqué → 403 DEVICE_REVOKED (pas de réactivation silencieuse)', async () => {
    await POST(req({ license: 'GF2.x.y.z', hwid: HWID_A }) as never)
    deviceStore.rows[0].status = 'revoked'
    const res = await POST(req({ license: 'GF2.x.y.z', hwid: HWID_A }) as never)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('DEVICE_REVOKED')
  })

  it('activation sans HWID (navigateur PWA) → pas de deviceToken, pas d\'appareil', async () => {
    const res = await POST(req({ license: 'GF2.x.y.z' }) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deviceToken).toBeUndefined()
    expect(deviceStore.rows).toHaveLength(0)
  })
})
