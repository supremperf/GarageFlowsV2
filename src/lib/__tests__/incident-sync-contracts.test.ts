import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LicenseConfigurationError } from '@/lib/license/failures'
const state = vi.hoisted(() => ({ error: null as unknown, tampered: false, invalid: false, queryError: null as unknown }))
vi.mock('@/lib/db', () => {
  const query = async () => { if (state.queryError) throw state.queryError; return [] }
  const model = new Proxy({}, { get: () => query })
  const prisma = new Proxy({}, { get: (_, name) => name === 'licenseKey' ? {
    findUnique: async () => {
      if (state.error) throw state.error
      return { licenseId: 'synthetic-license', licenseType: 'premium', status: 'active',
        garageId: 'synthetic-garage', expiryAt: new Date('2099-01-01') }
    },
  } : model })
  return { prisma, isPostgresDatabase: () => false, serverPrisma: () => prisma }
})
vi.mock('@/lib/license/verify', () => ({
  verifyLicenseToken: () => ({ valid: !state.invalid, payload: { lid: 'synthetic-license', typ: 'premium' } }),
}))
vi.mock('@/lib/license/record-mac', () => ({
  verifyRecordMac: () => ({ tampered: state.tampered }),
  recordIntegrityUsable: (m: { tampered: boolean }) => !m.tampered,
  computeRecordMac: () => 'synthetic-mac',
}))
vi.mock('@/lib/security/rate-limit', () => ({
  enforceRateLimit: async () => ({ ok: true }), clientIpFrom: () => 'test', rateLimitResponse: vi.fn(),
}))
import { POST as appointments } from '@/app/api/sync/appointments/route'
import { POST as einvoicing } from '@/app/api/sync/einvoicing/route'
import { POST as invoice } from '@/app/api/sync/invoice/route'
import { POST as jobPhoto } from '@/app/api/sync/job-photo/route'
import { POST as jobs } from '@/app/api/sync/jobs/route'
import { POST as mechanicAssignment } from '@/app/api/sync/mechanic-assignment/route'
import { POST as mechanicAvatar } from '@/app/api/sync/mechanic-avatar/route'
import { POST as mechanicStatus } from '@/app/api/sync/mechanic-status/route'
import { POST as portalAccount } from '@/app/api/sync/portal-account/route'
import { POST as portal } from '@/app/api/sync/portal/route'
import { POST as quoteReturn } from '@/app/api/sync/quote-return/route'
import { POST as quote } from '@/app/api/sync/quote/route'
import { POST as tickets } from '@/app/api/sync/tickets/route'

const handlers = { appointments, einvoicing, invoice, jobPhoto, jobs, mechanicAssignment, mechanicAvatar,
  mechanicStatus, portalAccount, portal, quoteReturn, quote, tickets }
const body = {
  garageLicense: 'GF2.synthetic.payload.signature', garageId: 'synthetic-garage',
  garage: { id: 'synthetic-garage' }, mechanic: { id: 'synthetic-mechanic' },
  mechanicLicense: 'GF2.synthetic.mechanic.signature', status: 'revoked',
  window: { from: '2026-10-01', to: '2026-10-31' }, photoId: 'synthetic-photo',
  jobId: 'synthetic-job', payload: {},
}
const req = () => new Request('https://example.invalid/api/sync/test', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
beforeEach(() => { state.error = null; state.tampered = false; state.invalid = false; state.queryError = null })
afterEach(() => vi.unstubAllEnvs())
for (const [name, handler] of Object.entries(handlers)) {
  describe(`/api/sync/${name} : contrat de frontière réelle`, () => {
    it('JSON null n’est pas une erreur DB/licence : 400 BAD_REQUEST', async () => {
      const res = await handler(new Request('https://example.invalid', { method: 'POST', body: 'null' }))
      expect(res.status).toBe(400); expect((await res.json()).code).toBe('BAD_REQUEST')
    })

    it.each([
      [Object.assign(new Error('Prisma { kind: Closed }'), { code: 'P1001' }), 503, 'DB_UNAVAILABLE'],
      [new LicenseConfigurationError(), 500, 'SERVER_MISCONFIGURED'],
    ])('exception pendant auth → HTTP/code infra exact', async (error, status, code) => {
      state.error = error
      const res = await handler(req())
      expect(res.status).toBe(status); expect(await res.json()).toMatchObject({ ok: false, code })
    })
    it('signature invalide → 403 LICENSE_INVALID', async () => {
      state.invalid = true
      const res = await handler(req())
      expect(res.status).toBe(403); expect(await res.json()).toMatchObject({ ok: false, code: 'LICENSE_INVALID' })
    })
    it('MAC altéré → 403 LICENSE_TAMPERED', async () => {
      state.tampered = true
      const res = await handler(req())
      expect(res.status).toBe(403); expect(await res.json()).toMatchObject({ ok: false, code: 'LICENSE_TAMPERED' })
    })
  })
}

it.each([['tickets', tickets], ['appointments', appointments], ['quote-return', quoteReturn]] as const)(
  '%s : panne DB après auth → DB_UNAVAILABLE aussi', async (_name, handler) => {
    state.queryError = new Error('Prisma { kind: Closed }')
    const res = await handler(req())
    expect(res.status).toBe(503); expect((await res.json()).code).toBe('DB_UNAVAILABLE')
  },
)
