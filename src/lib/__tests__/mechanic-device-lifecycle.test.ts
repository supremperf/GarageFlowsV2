/**
 * §1/§2/§3 — Cycle de vie des appareils mécanicien.
 *
 * Prouve : déconnexion ≠ révocation (siège libéré, reconnexion possible),
 * révocation irréversible et permanente, suspension qui CONSERVE le siège
 * (les appareils ne sont pas touchés), et la contrainte de transition d'état.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.GF_DB_MAC_SECRET = 'test-mac-secret'

const cap = vi.hoisted(() => ({
  deviceUpdates: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  license: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    licenseDevice: {
      updateMany: async (a: Record<string, unknown>) => { cap.deviceUpdates.push(a); return { count: 2 } },
    },
    licenseDeviceEvent: { create: async (a: { data: Record<string, unknown> }) => { cap.events.push(a.data); return a.data } },
    licenseKey: {
      findFirst: async () => cap.license,
      update: async (a: { data: unknown }) => a.data,
    },
    mechanicActionAudit: { create: async (a: { data: unknown }) => a.data },
  },
  isPostgresDatabase: () => false,
}))
vi.mock('@/lib/api-helpers', () => ({
  requireSession: async () => ({ user: { id: 'owner1', role: 'OWNER', garageId: 'gA' } }),
  withAuth: (h: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => {
      try { return await h(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e }
    },
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

import { canTransitionDevice, isSeatConsumingStatus, DEVICE_STATES } from '@/lib/license/devices'
import { disconnectDevices, revokeDevices } from '@/lib/license/mechanic-admin'
import { POST as DISCONNECT } from '@/app/api/mechanic-licenses/[lid]/disconnect/route'
import { POST as STATUS } from '@/app/api/mechanic-licenses/[lid]/status/route'

beforeEach(() => { cap.deviceUpdates = []; cap.events = []; cap.license = null })

describe('§1 — machine à états d\'appareil', () => {
  it('seuls active/deactivated/revoked existent, et seul active consomme un siège', () => {
    expect([...DEVICE_STATES]).toEqual(['active', 'deactivated', 'revoked'])
    expect(isSeatConsumingStatus('active')).toBe(true)
    expect(isSeatConsumingStatus('deactivated')).toBe(false) // disconnected : siège libéré
    expect(isSeatConsumingStatus('revoked')).toBe(false)
  })
  it('transitions autorisées', () => {
    expect(canTransitionDevice('active', 'deactivated')).toBe(true)
    expect(canTransitionDevice('deactivated', 'active')).toBe(true) // reconnexion
    expect(canTransitionDevice('active', 'revoked')).toBe(true)
    expect(canTransitionDevice('deactivated', 'revoked')).toBe(true)
  })
  it('révocation IRRÉVERSIBLE : revoked → * interdit', () => {
    expect(canTransitionDevice('revoked', 'active')).toBe(false)
    expect(canTransitionDevice('revoked', 'deactivated')).toBe(false)
  })
})

describe('§2 — disconnectDevices : désactive, ne révoque JAMAIS', () => {
  it('passe les appareils actifs à deactivated (siège libéré, reconnexion possible)', async () => {
    const n = await disconnectDevices('L1')
    expect(n).toBe(2)
    const u = cap.deviceUpdates.at(-1)!
    expect((u.where as Record<string, unknown>).status).toBe('active')
    expect((u.data as Record<string, unknown>).status).toBe('deactivated')
    // jamais de révocation
    expect((u.data as Record<string, unknown>).status).not.toBe('revoked')
    expect(cap.events.at(-1)!.action).toBe('deactivated')
  })
})

describe('§1 — revokeDevices : révocation permanente (actifs + déconnectés)', () => {
  it('passe les appareils à revoked', async () => {
    const n = await revokeDevices('L1', 'license_revoked')
    expect(n).toBe(2)
    const u = cap.deviceUpdates.at(-1)!
    expect((u.data as Record<string, unknown>).status).toBe('revoked')
    expect(cap.events.at(-1)!.action).toBe('revoked')
  })
})

function statusReq(status: string) {
  const req = new Request('http://127.0.0.1/api/mechanic-licenses/L1/status', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
  })
  return (STATUS as unknown as (r: Request, c: { params: { lid: string } }) => Promise<Response>)(req, { params: { lid: 'L1' } })
}

describe('§2/§3 — effets appareils selon la transition de licence', () => {
  const baseLicense = () => ({
    id: 1, licenseId: 'L1', token: 'tok', status: 'active',
    expiryAt: new Date('2030-01-01T00:00:00Z'), hwid: null,
    parentLicenseId: 'P1', mechanicId: 'M1', revokedAt: null, suspendedAt: null,
  })

  it('DISCONNECT route → appareils deactivated, licence NON révoquée', async () => {
    cap.license = { licenseId: 'L1', mechanicId: 'M1' }
    const req = new Request('http://127.0.0.1/api/mechanic-licenses/L1/disconnect', { method: 'POST' })
    const res = await (DISCONNECT as unknown as (r: Request, c: { params: { lid: string } }) => Promise<Response>)(req, { params: { lid: 'L1' } })
    expect(res.status).toBe(200)
    expect((cap.deviceUpdates.at(-1)!.data as Record<string, unknown>).status).toBe('deactivated')
  })

  it('SUSPEND → n\'AUCUNE écriture appareil (siège conservé, restauration instantanée)', async () => {
    cap.license = baseLicense()
    const res = await statusReq('suspended')
    expect(res.status).toBe(200)
    expect(cap.deviceUpdates.length).toBe(0) // les appareils ne sont PAS touchés
  })

  it('REVOKE → appareils révoqués (permanent)', async () => {
    cap.license = baseLicense()
    const res = await statusReq('revoked')
    expect(res.status).toBe(200)
    expect((cap.deviceUpdates.at(-1)!.data as Record<string, unknown>).status).toBe('revoked')
  })
})
