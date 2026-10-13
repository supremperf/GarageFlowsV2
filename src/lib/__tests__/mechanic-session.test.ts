/**
 * Validation de session MÉCANICIEN (mechanic-session.ts) — cœur de l'isolation.
 *
 * Prisma est simulé ; le cookie gf_session est un VRAI JWT signé (jose). On
 * prouve qu'une session mécanicien n'est acceptée QUE si toute la chaîne est
 * cohérente (licence attribuée + parente valide + mécanicien du garage), et
 * qu'une réattribution / révocation / clé d'un autre type la font échouer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SignJWT } from 'jose'

process.env.NEXTAUTH_SECRET = 'x'.repeat(48)
process.env.GF_DB_MAC_SECRET = 'test-mac-secret'
delete process.env.ELECTRON

const store = vi.hoisted(() => {
  const licenses = new Map<string, any>()
  const mechanics = new Map<string, any>()
  const devices = new Map<string, any>()
  // Résultat de vérification MAC contrôlable par test (défaut : MAC valide présent).
  const macResult = { ok: true, tampered: false, missing: false }
  return { licenses, mechanics, devices, macResult }
})

vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: { findUnique: async ({ where }: any) => store.licenses.get(where.licenseId) ?? null },
    mechanic: { findFirst: async ({ where }: any) => {
      const m = store.mechanics.get(where.id)
      return m && m.garageId === where.garageId ? m : null
    } },
    licenseDevice: { findUnique: async ({ where }: any) => store.devices.get(where.deviceId) ?? null },
  },
  isPostgresDatabase: () => false,
}))
// MAC contrôlable : par défaut valide et présent (missing:false).
vi.mock('@/lib/license/record-mac', () => ({
  verifyRecordMac: () => store.macResult,
}))

import { validateMechanicSession } from '@/lib/license/mechanic-session'

async function cookie(payload: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET!)
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d').sign(secret)
}

const future = new Date(Date.now() + 86_400_000)

function seed() {
  store.licenses.clear(); store.mechanics.clear(); store.devices.clear()
  store.macResult.ok = true; store.macResult.tampered = false; store.macResult.missing = false
  store.licenses.set('parent-1', { licenseId: 'parent-1', licenseType: 'premium', status: 'active', revokedAt: null, expiryAt: future, garageId: 'garage-1' })
  store.licenses.set('mech-lic-1', { licenseId: 'mech-lic-1', licenseType: 'mechanic', status: 'active', revokedAt: null, expiryAt: future, garageId: 'garage-1', parentLicenseId: 'parent-1', mechanicId: 'mecaA', token: 't', hwid: null, recordMac: 'x' })
  store.mechanics.set('mecaA', { id: 'mecaA', garageId: 'garage-1' })
  store.mechanics.set('mecaB', { id: 'mecaB', garageId: 'garage-1' })
  store.devices.set('dev-1', { deviceId: 'dev-1', licenseId: 'mech-lic-1', status: 'active' })
}

beforeEach(seed)

const goodSession = () => cookie({ typ: 'mechanic', lid: 'mech-lic-1', gid: 'garage-1', mid: 'mecaA', did: 'dev-1' })

describe('mechanic-session — cas nominal', () => {
  it('accepte une session cohérente et renvoie garageId/mechanicId de confiance', async () => {
    const r = await validateMechanicSession({ rawGfSession: await goodSession() })
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.ctx.garageId).toBe('garage-1'); expect(r.ctx.mechanicId).toBe('mecaA') }
  })
})

describe('mechanic-session — rejets de sécurité', () => {
  it('refuse une session vide', async () => {
    const r = await validateMechanicSession({ rawGfSession: '' })
    expect(r.ok).toBe(false)
  })

  it('refuse une session de type garage (pas mechanic)', async () => {
    const r = await validateMechanicSession({ rawGfSession: await cookie({ typ: 'premium', lid: 'mech-lic-1', gid: 'garage-1', mid: 'mecaA' }) })
    expect(r.ok).toBe(false)
  })

  it('refuse si la clé a été RÉATTRIBUÉE (mid ne correspond plus)', async () => {
    // L'ancienne session porte mid=mecaA mais la clé pointe désormais mecaB.
    store.licenses.get('mech-lic-1').mechanicId = 'mecaB'
    const r = await validateMechanicSession({ rawGfSession: await goodSession() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('MECHANIC_FORBIDDEN')
  })

  it('refuse une clé non attribuée', async () => {
    store.licenses.get('mech-lic-1').mechanicId = null
    const r = await validateMechanicSession({ rawGfSession: await goodSession() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('MECHANIC_KEY_UNASSIGNED')
  })

  it('refuse une clé révoquée', async () => {
    store.licenses.get('mech-lic-1').status = 'revoked'
    const r = await validateMechanicSession({ rawGfSession: await goodSession() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('MECHANIC_LICENSE_REVOKED')
  })

  it('refuse si la licence Garage parente est révoquée', async () => {
    store.licenses.get('parent-1').status = 'revoked'
    const r = await validateMechanicSession({ rawGfSession: await goodSession() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('PARENT_LICENSE_INVALID')
  })

  it('refuse si l\'appareil a été révoqué', async () => {
    store.devices.get('dev-1').status = 'revoked'
    const r = await validateMechanicSession({ rawGfSession: await goodSession() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('MECHANIC_DEVICE_REVOKED')
  })

  it('refuse un gid falsifié dans le cookie (incohérent avec la base)', async () => {
    const r = await validateMechanicSession({ rawGfSession: await cookie({ typ: 'mechanic', lid: 'mech-lic-1', gid: 'garage-999', mid: 'mecaA', did: 'dev-1' }) })
    expect(r.ok).toBe(false)
  })

  it('refuse un recordMac ALTÉRÉ (mechanicId modifié en base)', async () => {
    store.macResult.tampered = true; store.macResult.missing = false; store.macResult.ok = false
    const r = await validateMechanicSession({ rawGfSession: await goodSession() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('MECHANIC_LICENSE_TAMPERED')
  })

  it('refuse un recordMac ABSENT (mise à NULL du MAC pour usurper — F1)', async () => {
    // Une clé mécanicien est toujours créée AVEC un MAC : un MAC absent = altération.
    store.macResult.tampered = false; store.macResult.missing = true; store.macResult.ok = true
    const r = await validateMechanicSession({ rawGfSession: await goodSession() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('MECHANIC_LICENSE_TAMPERED')
  })
})
