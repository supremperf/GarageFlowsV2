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
const licenseKey = {
  record: null as Record<string, unknown> | null,
  findUnique: vi.fn(async () => licenseKey.record),
  update: vi.fn(async () => ({})),
  create: vi.fn(async () => ({})),
}
vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findUnique: () => licenseKey.findUnique(),
      update: () => licenseKey.update(),
      create: () => licenseKey.create(),
    },
  },
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
})
