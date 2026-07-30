/**
 * Prouve le CÂBLAGE de l'enforcement : requireSession() (utilisé par toutes les
 * API métier via withAuth) refuse un accès direct sans session licenciée valide,
 * et l'autorise avec. C'est la preuve « accès direct aux API sans licence bloqué ».
 *
 * NextAuth et next/headers sont simulés ; Prisma est un magasin mémoire ; le
 * cookie gf_session est un VRAI JWT signé. Enforcement activé via
 * LICENSE_ENFORCEMENT=on (NODE_ENV=test).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SignJWT } from 'jose'
import { NextResponse } from 'next/server'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)
process.env.LICENSE_ENFORCEMENT = 'on'
delete process.env.ELECTRON

const ctl = vi.hoisted(() => ({
  nextAuthSession: null as unknown,
  gfCookie: '' as string,
  licenses: new Map<string, { licenseId: string; status: string; revokedAt: Date | null; expiryAt: Date; garageId: string | null }>(),
  devices: new Map<string, { deviceId: string; licenseId: string; status: string }>(),
}))

vi.mock('next-auth', () => ({ getServerSession: async () => ctl.nextAuthSession }))
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (name: string) => (name === 'gf_session' && ctl.gfCookie ? { value: ctl.gfCookie } : undefined) }),
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findUnique: async ({ where }: { where: { licenseId: string } }) => ctl.licenses.get(where.licenseId) ?? null,
      updateMany: async ({ where, data }: { where: { licenseId: string }; data: { garageId: string } }) => {
        const l = ctl.licenses.get(where.licenseId)
        if (l && l.garageId === null) { l.garageId = data.garageId; return { count: 1 } }
        return { count: 0 }
      },
    },
    licenseDevice: {
      findUnique: async ({ where }: { where: { deviceId: string } }) => ctl.devices.get(where.deviceId) ?? null,
    },
  },
  isPostgresDatabase: () => false,
}))

import { requireSession } from '@/lib/api-helpers'

async function gf(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d')
    .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET))
}

async function statusOfThrow(fn: () => Promise<unknown>): Promise<number | 'no-throw'> {
  try { await fn(); return 'no-throw' } catch (e) {
    if (e instanceof NextResponse) return e.status
    throw e
  }
}

beforeEach(() => {
  ctl.nextAuthSession = null
  ctl.gfCookie = ''
  ctl.licenses.clear()
  ctl.devices.clear()
})

describe('requireSession — enforcement licencié (serveur/PWA)', () => {
  it('non authentifié → 401', async () => {
    expect(await statusOfThrow(() => requireSession())).toBe(401)
  })

  it('authentifié mais SANS session de licence → 401 (accès direct bloqué)', async () => {
    ctl.nextAuthSession = { user: { garageId: 'garage-A' } }
    ctl.gfCookie = '' // aucun gf_session : l'utilisateur est loggué mais non licencié
    expect(await statusOfThrow(() => requireSession())).toBe(401)
  })

  it('licence valide + appareil actif + garage → autorisé', async () => {
    ctl.nextAuthSession = { user: { garageId: 'garage-A' } }
    ctl.licenses.set('lid-1', { licenseId: 'lid-1', status: 'active', revokedAt: null, expiryAt: new Date(Date.now() + 1e9), garageId: 'garage-A' })
    ctl.devices.set('dev-1', { deviceId: 'dev-1', licenseId: 'lid-1', status: 'active' })
    ctl.gfCookie = await gf({ typ: 'premium', lid: 'lid-1', did: 'dev-1' })
    const session = await requireSession() as { user: { garageId: string } }
    expect(session.user.garageId).toBe('garage-A')
  })

  it('licence d\'un AUTRE garage → 403 (isolation inter-tenant)', async () => {
    ctl.nextAuthSession = { user: { garageId: 'garage-A' } }
    ctl.licenses.set('lid-1', { licenseId: 'lid-1', status: 'active', revokedAt: null, expiryAt: new Date(Date.now() + 1e9), garageId: 'garage-B' })
    ctl.devices.set('dev-1', { deviceId: 'dev-1', licenseId: 'lid-1', status: 'active' })
    ctl.gfCookie = await gf({ typ: 'premium', lid: 'lid-1', did: 'dev-1' })
    expect(await statusOfThrow(() => requireSession())).toBe(403)
  })

  it('appareil révoqué → 403 même avec une session encore signée (révocation immédiate)', async () => {
    ctl.nextAuthSession = { user: { garageId: 'garage-A' } }
    ctl.licenses.set('lid-1', { licenseId: 'lid-1', status: 'active', revokedAt: null, expiryAt: new Date(Date.now() + 1e9), garageId: 'garage-A' })
    ctl.devices.set('dev-1', { deviceId: 'dev-1', licenseId: 'lid-1', status: 'revoked' })
    ctl.gfCookie = await gf({ typ: 'premium', lid: 'lid-1', did: 'dev-1' })
    expect(await statusOfThrow(() => requireSession())).toBe(403)
  })
})
