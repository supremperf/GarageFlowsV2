/**
 * Tests de la validation de session licenciée (src/lib/license/session.ts) —
 * cœur de l'enforcement serveur des API métier. Prisma est simulé par un magasin
 * mémoire ; les cookies gf_session sont de VRAIS JWT signés (jose) avec le secret
 * de test — la vérification cryptographique est donc réelle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SignJWT } from 'jose'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

// ── Magasin Prisma simulé ────────────────────────────────────────────────────
const store = vi.hoisted(() => {
  type Lic = { licenseId: string; status: string; revokedAt: Date | null; expiryAt: Date; garageId: string | null; seats: number }
  type Dev = { deviceId: string; licenseId: string; status: string }
  const licenses = new Map<string, Lic>()
  const devices = new Map<string, Dev>()
  return { licenses, devices }
})

vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findUnique: async ({ where }: { where: { licenseId: string } }) =>
        store.licenses.get(where.licenseId) ?? null,
      updateMany: async ({ where, data }: { where: { licenseId: string; garageId: null }; data: { garageId: string } }) => {
        const lic = store.licenses.get(where.licenseId)
        if (lic && lic.garageId === null) {
          lic.garageId = data.garageId
          return { count: 1 }
        }
        return { count: 0 }
      },
    },
    licenseDevice: {
      findUnique: async ({ where }: { where: { deviceId: string } }) =>
        store.devices.get(where.deviceId) ?? null,
    },
  },
  isPostgresDatabase: () => false,
}))

import { validateLicensedSession } from '@/lib/license/session'

async function gfSession(payload: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET)
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret)
}

const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000)
const PAST = new Date(Date.now() - 1000)

beforeEach(() => {
  store.licenses.clear()
  store.devices.clear()
})

function seed(lic: Partial<{ licenseId: string; status: string; revokedAt: Date | null; expiryAt: Date; garageId: string | null; seats: number }> = {}) {
  const l = {
    licenseId: 'lid-1', status: 'active', revokedAt: null, expiryAt: FUTURE,
    garageId: null as string | null, seats: 1, ...lic,
  }
  store.licenses.set(l.licenseId, l)
  return l
}
function seedDevice(dev: Partial<{ deviceId: string; licenseId: string; status: string }> = {}) {
  const d = { deviceId: 'dev-1', licenseId: 'lid-1', status: 'active', ...dev }
  store.devices.set(d.deviceId, d)
  return d
}

describe('validateLicensedSession — chemin nominal', () => {
  it('licence active + appareil actif + garage → ok, rattachement au 1er usage', async () => {
    const lic = seed({ garageId: null })
    seedDevice()
    const raw = await gfSession({ typ: 'premium', lid: 'lid-1', did: 'dev-1' })
    const res = await validateLicensedSession({ rawGfSession: raw, garageId: 'garage-A' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.ctx.garageId).toBe('garage-A')
    // bind-on-first-use : la licence est désormais rattachée à garage-A.
    expect(lic.garageId).toBe('garage-A')
  })
})

describe('validateLicensedSession — échecs licence', () => {
  it('cookie absent → LICENSE_SESSION_MISSING (401)', async () => {
    const res = await validateLicensedSession({ rawGfSession: '', garageId: 'garage-A' })
    expect(res).toMatchObject({ ok: false, code: 'LICENSE_SESSION_MISSING', status: 401 })
  })

  it('JWT invalide (mauvaise signature) → LICENSE_SESSION_MISSING', async () => {
    const res = await validateLicensedSession({ rawGfSession: 'aaa.bbb.ccc', garageId: 'garage-A' })
    expect(res).toMatchObject({ ok: false, code: 'LICENSE_SESSION_MISSING' })
  })

  it('licence inconnue → LICENSE_UNKNOWN', async () => {
    const raw = await gfSession({ typ: 'premium', lid: 'ghost', did: 'dev-1' })
    const res = await validateLicensedSession({ rawGfSession: raw, garageId: 'garage-A' })
    expect(res).toMatchObject({ ok: false, code: 'LICENSE_UNKNOWN' })
  })

  it('licence révoquée → LICENSE_REVOKED (403) — révocation immédiate', async () => {
    seed({ status: 'revoked', revokedAt: new Date(), garageId: 'garage-A' })
    seedDevice()
    const raw = await gfSession({ typ: 'premium', lid: 'lid-1', did: 'dev-1' })
    const res = await validateLicensedSession({ rawGfSession: raw, garageId: 'garage-A' })
    expect(res).toMatchObject({ ok: false, code: 'LICENSE_REVOKED', status: 403 })
  })

  it('licence suspendue → LICENSE_SUSPENDED', async () => {
    seed({ status: 'suspended', garageId: 'garage-A' })
    seedDevice()
    const raw = await gfSession({ typ: 'premium', lid: 'lid-1', did: 'dev-1' })
    const res = await validateLicensedSession({ rawGfSession: raw, garageId: 'garage-A' })
    expect(res).toMatchObject({ ok: false, code: 'LICENSE_SUSPENDED' })
  })

  it('licence expirée → LICENSE_EXPIRED', async () => {
    seed({ expiryAt: PAST, garageId: 'garage-A' })
    seedDevice()
    const raw = await gfSession({ typ: 'premium', lid: 'lid-1', did: 'dev-1' })
    const res = await validateLicensedSession({ rawGfSession: raw, garageId: 'garage-A' })
    expect(res).toMatchObject({ ok: false, code: 'LICENSE_EXPIRED' })
  })
})

describe('validateLicensedSession — isolation inter-garages (anti-cross-tenant)', () => {
  it('licence rattachée à un AUTRE garage → LICENSE_GARAGE_MISMATCH (403)', async () => {
    seed({ garageId: 'garage-B' })
    seedDevice()
    const raw = await gfSession({ typ: 'premium', lid: 'lid-1', did: 'dev-1' })
    const res = await validateLicensedSession({ rawGfSession: raw, garageId: 'garage-A' })
    expect(res).toMatchObject({ ok: false, code: 'LICENSE_GARAGE_MISMATCH', status: 403 })
  })

  it('rattachement au 1er garage, puis un 2e garage réutilisant la même licence est refusé', async () => {
    seed({ garageId: null })
    seedDevice()
    const raw = await gfSession({ typ: 'premium', lid: 'lid-1', did: 'dev-1' })
    // garage-A se rattache…
    expect((await validateLicensedSession({ rawGfSession: raw, garageId: 'garage-A' })).ok).toBe(true)
    // …garage-B tente la même licence → refus.
    const res = await validateLicensedSession({ rawGfSession: raw, garageId: 'garage-B' })
    expect(res).toMatchObject({ ok: false, code: 'LICENSE_GARAGE_MISMATCH' })
  })
})

describe('validateLicensedSession — échecs appareil', () => {
  it('session sans did (ancienne) → DEVICE_REQUIRED', async () => {
    seed({ garageId: 'garage-A' })
    const raw = await gfSession({ typ: 'premium', lid: 'lid-1' }) // pas de did
    const res = await validateLicensedSession({ rawGfSession: raw, garageId: 'garage-A' })
    expect(res).toMatchObject({ ok: false, code: 'DEVICE_REQUIRED' })
  })

  it('appareil inconnu (supprimé/réinitialisé) → DEVICE_UNKNOWN', async () => {
    seed({ garageId: 'garage-A' })
    const raw = await gfSession({ typ: 'premium', lid: 'lid-1', did: 'ghost-device' })
    const res = await validateLicensedSession({ rawGfSession: raw, garageId: 'garage-A' })
    expect(res).toMatchObject({ ok: false, code: 'DEVICE_UNKNOWN' })
  })

  it('appareil appartenant à une AUTRE licence → DEVICE_UNKNOWN', async () => {
    seed({ garageId: 'garage-A' })
    seedDevice({ deviceId: 'dev-x', licenseId: 'autre-licence' })
    const raw = await gfSession({ typ: 'premium', lid: 'lid-1', did: 'dev-x' })
    const res = await validateLicensedSession({ rawGfSession: raw, garageId: 'garage-A' })
    expect(res).toMatchObject({ ok: false, code: 'DEVICE_UNKNOWN' })
  })

  it('appareil révoqué → DEVICE_REVOKED (403) — révocation immédiate', async () => {
    seed({ garageId: 'garage-A' })
    seedDevice({ status: 'revoked' })
    const raw = await gfSession({ typ: 'premium', lid: 'lid-1', did: 'dev-1' })
    const res = await validateLicensedSession({ rawGfSession: raw, garageId: 'garage-A' })
    expect(res).toMatchObject({ ok: false, code: 'DEVICE_REVOKED', status: 403 })
  })
})
