import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ findError: null as unknown }))

vi.mock('@/lib/security/rate-limit', () => ({
  clientIpFrom: () => 'test-ip',
  enforceRateLimit: async () => ({ ok: true, remaining: 99 }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}))
vi.mock('jose', () => ({
  jwtVerify: async () => ({ payload: { lid: 'test-license-id' } }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findUnique: async () => {
        if (state.findError) throw state.findError
        return { licenseId: 'test-license-id', status: 'active', expiryAt: new Date(Date.now() + 60_000), recordMac: 'mac' }
      },
    },
  },
}))
vi.mock('@/lib/license/record-mac', () => ({
  verifyRecordMac: () => ({ ok: true, tampered: false, missing: false }),
  recordIntegrityUsable: () => true,
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/license/status/route'

const ENV = ['NEXTAUTH_SECRET', 'ELECTRON'] as const
const previous: Record<string, string | undefined> = {}

function req(): NextRequest {
  return new NextRequest('http://127.0.0.1/api/license/status', {
    headers: { cookie: 'gf_session=redacted-test-cookie' },
  })
}

beforeEach(() => {
  for (const name of ENV) previous[name] = process.env[name]
  process.env.NEXTAUTH_SECRET = 'safe-test-secret-with-more-than-32-characters'
  delete process.env.ELECTRON
  state.findError = null
})
afterEach(() => {
  for (const name of ENV) {
    if (previous[name] === undefined) delete process.env[name]
    else process.env[name] = previous[name]
  }
})

describe('GET /api/license/status — configuration et disponibilité', () => {
  it('secret de session absent → SERVER_MISCONFIGURED, jamais unknown fail-open', async () => {
    delete process.env.NEXTAUTH_SECRET
    const response = await GET(req())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: 'SERVER_MISCONFIGURED' })
  })

  it('Prisma Closed PWA → 503 DB_UNAVAILABLE', async () => {
    state.findError = { cause: { kind: 'Closed' } }
    const response = await GET(req())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'DB_UNAVAILABLE' })
  })

  it('Prisma Closed Electron → unknown, pas de faux état révoqué', async () => {
    process.env.ELECTRON = '1'
    state.findError = { cause: { kind: 'Closed' } }
    const response = await GET(req())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ allowed: true, status: 'unknown' })
  })
})
