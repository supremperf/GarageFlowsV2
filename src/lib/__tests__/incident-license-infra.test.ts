import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'
import { LicenseConfigurationError, licenseFailure } from '@/lib/license/failures'

const state = vi.hoisted(() => ({
  verifyError: null as unknown, dbError: null as unknown, deviceError: null as unknown, tampered: false, mechanic: false,
  record: null as Record<string, unknown> | null,
  db: vi.fn(), device: vi.fn(), denied: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ prisma: {
  licenseKey: { findUnique: (...a: unknown[]) => state.db(...a), create: vi.fn(), update: vi.fn() },
}, isPostgresDatabase: () => false }))
vi.mock('@/lib/security/rate-limit', () => ({
  enforceRateLimit: async () => ({ ok: true }), clientIpFrom: () => 'test', rateLimitResponse: vi.fn(),
}))
vi.mock('@/lib/license/verify', async (original) => ({
  ...await original<typeof import('@/lib/license/verify')>(),
  verifyLicenseToken: () => { if (state.verifyError) throw state.verifyError; return ({ valid: true, isAdmin: false, isMechanic: state.mechanic, payload: {
    lid: 'synthetic-license', cid: 'synthetic-client', typ: state.mechanic ? 'mechanic' : 'premium',
    seats: 1, exp: 4100000000, iss: 1700000000, ver: '2.0', wm: '', plid: 'synthetic-parent',
  } }) },
}))
vi.mock('@/lib/license/record-mac', () => ({
  verifyRecordMac: () => ({ tampered: state.tampered, missing: false }),
  recordIntegrityUsable: (m: { tampered: boolean }) => !m.tampered,
  computeRecordMac: () => 'synthetic-mac',
}))
vi.mock('@/lib/license/devices', async (original) => ({
  ...await original<typeof import('@/lib/license/devices')>(),
  activateDevice: (...a: unknown[]) => state.device(...a),
  validateDeviceToken: async () => { if (state.dbError) throw state.dbError; return { ok: false, code: 'license_revoked' } },
  deactivateByToken: async () => { if (state.dbError) throw state.dbError },
  recordDeviceDenial: (...a: unknown[]) => state.denied(...a),
}))
import { POST as activate } from '@/app/api/license/activate/route'
import { POST as check } from '@/app/api/license/check/route'
import { POST as deactivate } from '@/app/api/license/deactivate/route'
import { GET as status } from '@/app/api/license/status/route'
import { GET as devices } from '@/app/api/license/devices/route'
import { DeviceLimitError, DeviceRevokedError } from '@/lib/license/devices'

function req(body: unknown = {}, cookie?: string) {
  return new NextRequest('https://example.invalid/api/license/check', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie: `gf_session=${cookie}` } : {}) },
  })
}
async function session() {
  return new SignJWT({ lid: 'synthetic-license' }).setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h').sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET!))
}
const activationBody = { license: 'GF2.synthetic.payload.signature', hwid: 'a'.repeat(64) }
beforeEach(() => {
  vi.stubEnv('NEXTAUTH_SECRET', 's'.repeat(48))
  vi.stubEnv('GF_DB_MAC_SECRET', 'm'.repeat(48))
  state.record = { id: 'synthetic-id', licenseId: 'synthetic-license', licenseType: 'premium',
    status: 'active', expiryAt: new Date('2099-01-01'), seats: 1, garageId: 'synthetic-garage', hwid: null }
  state.verifyError = null; state.dbError = null; state.deviceError = null; state.tampered = false; state.mechanic = false
  state.db.mockReset().mockImplementation(async () => { if (state.dbError) throw state.dbError; return state.record })
  state.device.mockReset().mockImplementation(async () => {
    if (state.deviceError) throw state.deviceError
    return { deviceId: 'synthetic-device', deviceToken: 'synthetic-token' }
  })
  state.denied.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

const closed = new Error('Error in connector: { kind: Closed }')
const unavailable = [closed, { kind: 'Closed' }, Object.assign(new Error('unavailable'), { code: 'P1001' })]
describe('frontière technique : pas de confusion avec un refus métier', () => {
  it.each(unavailable)('Prisma fermé → DB_UNAVAILABLE', (error) => {
    expect(licenseFailure(error)).toEqual({ code: 'DB_UNAVAILABLE', status: 503 })
  })
  it('un bug inconnu reste INTERNAL_ERROR, pas une panne DB supposée', () => {
    expect(licenseFailure(new Error('unexpected'))).toEqual({ code: 'INTERNAL_ERROR', status: 500 })
  })
  it.each(['1', '0'])('activation Electron=%s : DB down → aucune session ni appareil', async (electron) => {
    vi.stubEnv('ELECTRON', electron); state.dbError = closed
    const res = await activate(req(activationBody))
    expect(res.status).toBe(503); expect((await res.json()).code).toBe('DB_UNAVAILABLE')
    expect(res.headers.has('set-cookie')).toBe(false); expect(state.device).not.toHaveBeenCalled()
  })
  it.each(['1', '0'])('activation Electron=%s : erreur appareil → aucune session', async (electron) => {
    vi.stubEnv('ELECTRON', electron); state.deviceError = closed
    const res = await activate(req(activationBody))
    expect(res.status).toBe(503); expect((await res.json()).code).toBe('DB_UNAVAILABLE')
    expect(res.headers.has('set-cookie')).toBe(false)
  })
  it.each(['1', '0'])('clé mécanicien Electron=%s : DB down ≠ clé non attribuée', async (electron) => {
    vi.stubEnv('ELECTRON', electron); state.mechanic = true; state.dbError = closed
    const res = await activate(req(activationBody))
    expect(res.status).toBe(503); expect((await res.json()).code).toBe('DB_UNAVAILABLE')
  })
  it.each([new DeviceLimitError(1), new DeviceRevokedError()])('refus siège/appareil ferme la session', async (error) => {
    vi.stubEnv('ELECTRON', '1'); state.deviceError = error
    const res = await activate(req(activationBody))
    expect(res.status).toBe(403); expect((await res.json()).ok).toBe(false)
    expect(res.headers.has('set-cookie')).toBe(false)
  })
  it.each(['', 'weak'])('secret absent/faible → SERVER_MISCONFIGURED avant toute écriture', async (value) => {
    vi.stubEnv('NEXTAUTH_SECRET', value)
    const res = await activate(req(activationBody))
    expect(res.status).toBe(500); expect((await res.json()).code).toBe('SERVER_MISCONFIGURED')
    expect(state.db).not.toHaveBeenCalled(); expect(res.headers.has('set-cookie')).toBe(false)
  })
  it('MAC invalide → LICENSE_TAMPERED, jamais LICENSE_INVALID', async () => {
    state.tampered = true
    const res = await activate(req(activationBody))
    expect((await res.json()).code).toBe('LICENSE_TAMPERED'); expect(res.headers.has('set-cookie')).toBe(false)
  })
  it('check conserve HTTP 200 + allowed:false sur révocation métier', async () => {
    const res = await check(req({ deviceToken: 'synthetic-token' }))
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ allowed: false, status: 'revoked' })
  })
  it('status conserve HTTP 200 + allowed:false sur révocation métier', async () => {
    state.record!.status = 'revoked'
    const res = await status(req({}, await session()))
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ allowed: false, status: 'revoked' })
  })
  it('check/deactivate DB down → 503 sur Electron aussi', async () => {
    vi.stubEnv('ELECTRON', '1'); state.dbError = closed
    for (const handler of [check, deactivate]) {
      const res = await handler(req({ deviceToken: 'synthetic-token' }))
      expect(res.status).toBe(503); expect((await res.json()).code).toBe('DB_UNAVAILABLE')
    }
  })
  it('status/devices : secret absent distinct d’un JWT invalide', async () => {
    for (const handler of [status, devices]) {
      vi.stubEnv('NEXTAUTH_SECRET', '')
      const res = await handler(req({}, 'invalid'))
      expect(res.status).toBe(500); expect((await res.json()).code).toBe('SERVER_MISCONFIGURED')
    }
  })
  it('status/devices : DB down ≠ révocation', async () => {
    const cookie = await session(); state.dbError = closed
    for (const handler of [status, devices]) {
      const res = await handler(req({}, cookie))
      expect(res.status).toBe(503); expect((await res.json()).code).toBe('DB_UNAVAILABLE')
    }
  })
  it('configuration explicitement typée', () => {
    expect(licenseFailure(new LicenseConfigurationError()).code).toBe('SERVER_MISCONFIGURED')
  })
})

it('clé publique mal configurée : route activation → 500 SERVER_MISCONFIGURED', async () => {
  state.verifyError = new LicenseConfigurationError()
  const res = await activate(req(activationBody))
  expect(res.status).toBe(500); expect((await res.json()).code).toBe('SERVER_MISCONFIGURED')
  expect(state.db).not.toHaveBeenCalled(); expect(res.headers.has('set-cookie')).toBe(false)
})
