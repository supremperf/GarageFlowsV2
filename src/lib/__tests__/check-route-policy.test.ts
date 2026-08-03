/**
 * /api/license/check — politique de version et fin du contournement « ancien
 * client sans jeton d'appareil ». Prouve : version trop ancienne → 426
 * UPGRADE_REQUIRED ; heartbeat licenseId seul (défaut sûr) → refusé
 * (DEVICE_TOKEN_REQUIRED, jamais allowed:true) ; jeton valide → allowed:true ;
 * fenêtre de migration ouverte → licenseId seul toléré.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

const state = vi.hoisted(() => ({
  tokenValid: true,
  licenseFound: true,
  failCode: 'device_unknown' as string,
  lastOpts: null as { hwid?: string; installId?: string } | null,
}))

vi.mock('@/lib/security/rate-limit', () => ({
  clientIpFrom: () => 'local',
  enforceRateLimit: async () => ({ ok: true, remaining: 99 }),
  rateLimitResponse: () => { throw new Error('unexpected') },
}))
vi.mock('@/lib/license/record-mac', () => ({ verifyRecordMac: () => ({ tampered: false, missing: false }) }))
vi.mock('@/lib/license/devices', () => ({
  validateDeviceToken: async (_token: string, opts: { hwid?: string; installId?: string } = {}) => {
    state.lastOpts = opts
    return state.tokenValid ? { ok: true, licenseId: 'lid-1', deviceId: 'dev-1' } : { ok: false, code: state.failCode }
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findUnique: async () => (state.licenseFound
        ? { id: 1, licenseId: 'lid-1', status: 'active', expiryAt: new Date(Date.now() + 1e9), recordMac: 'm' }
        : null),
      update: async () => ({}),
    },
  },
  isPostgresDatabase: () => false,
}))

import { POST } from '@/app/api/license/check/route'

function req(body: unknown): Request {
  return new Request('http://127.0.0.1/api/license/check', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

const ENVK = ['GF_MIN_ELECTRON_VERSION', 'GF_MIN_PWA_VERSION', 'GF_DEVICE_AUTH_DEADLINE', 'ELECTRON'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of ENVK) saved[k] = process.env[k]
  state.tokenValid = true; state.licenseFound = true
  state.failCode = 'device_unknown'; state.lastOpts = null
})
afterEach(() => {
  for (const k of ENVK) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

describe('/api/license/check — politique de version', () => {
  it('version Electron sous le minimum → 426 UPGRADE_REQUIRED', async () => {
    process.env.ELECTRON = '1'
    process.env.GF_MIN_ELECTRON_VERSION = '2.0.0'
    const res = await POST(req({ licenseId: 'lid-1', deviceToken: 't', version: '1.0.0' }) as never)
    expect(res.status).toBe(426)
    expect((await res.json()).code).toBe('UPGRADE_REQUIRED')
  })

  it('version supportée + jeton valide → allowed:true', async () => {
    process.env.ELECTRON = '1'
    process.env.GF_MIN_ELECTRON_VERSION = '1.0.0'
    const res = await POST(req({ licenseId: 'lid-1', deviceToken: 't', version: '1.2.0' }) as never)
    expect(res.status).toBe(200)
    expect((await res.json()).allowed).toBe(true)
  })
})

describe('/api/license/check — fin du contournement sans jeton', () => {
  it('licenseId seul, aucune fenêtre configurée → DEVICE_TOKEN_REQUIRED (jamais allowed:true)', async () => {
    delete process.env.GF_DEVICE_AUTH_DEADLINE
    const res = await POST(req({ licenseId: 'lid-1' }) as never)
    const body = await res.json()
    expect(body.allowed).toBe(false)
    expect(body.code).toBe('DEVICE_TOKEN_REQUIRED')
    expect(body.deviceRequired).toBe(true)
  })

  it('fenêtre de migration FUTURE → licenseId seul toléré (allowed:true, deviceRequired)', async () => {
    process.env.GF_DEVICE_AUTH_DEADLINE = '2999-01-01T00:00:00Z'
    const res = await POST(req({ licenseId: 'lid-1' }) as never)
    const body = await res.json()
    expect(body.allowed).toBe(true)
    expect(body.deviceRequired).toBe(true)
  })

  it('jeton d\'appareil invalide → refus typé (device_unknown → deviceRequired)', async () => {
    state.tokenValid = false
    const res = await POST(req({ licenseId: 'lid-1', deviceToken: 'bad' }) as never)
    const body = await res.json()
    // device_unknown ⇒ le client doit réactiver (jamais un blocage à tort).
    expect(body.deviceRequired).toBe(true)
  })
})

describe('/api/license/check — empreinte d\'appareil au heartbeat (item 3)', () => {
  it('transmet installId à validateDeviceToken (empreinte PWA vérifiée)', async () => {
    process.env.GF_MIN_PWA_VERSION = '1.0.0'
    const res = await POST(
      req({ licenseId: 'lid-1', deviceToken: 't', installId: 'pwa-install-123', version: '1.2.0' }) as never,
    )
    expect(res.status).toBe(200)
    expect(state.lastOpts).toMatchObject({ installId: 'pwa-install-123' })
  })

  it('transmet hwid à validateDeviceToken (empreinte Electron)', async () => {
    process.env.ELECTRON = '1'
    process.env.GF_MIN_ELECTRON_VERSION = '1.0.0'
    const res = await POST(
      req({ licenseId: 'lid-1', deviceToken: 't', hwid: 'HWID-abcdef012345', version: '1.2.0' }) as never,
    )
    expect(state.lastOpts).toMatchObject({ hwid: 'HWID-abcdef012345' })
  })

  it('installId ne correspondant pas (device_hwid_mismatch) → jamais allowed:true', async () => {
    process.env.GF_MIN_PWA_VERSION = '1.0.0'
    state.tokenValid = false
    state.failCode = 'device_hwid_mismatch'
    const res = await POST(
      req({ licenseId: 'lid-1', deviceToken: 't', installId: 'mauvais-install', version: '1.2.0' }) as never,
    )
    const body = await res.json()
    expect(body.allowed).not.toBe(true)
    // L'empreinte a bien été soumise à la vérification.
    expect(state.lastOpts).toMatchObject({ installId: 'mauvais-install' })
  })
})
