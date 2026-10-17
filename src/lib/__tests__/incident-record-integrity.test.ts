import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { computeRecordMac, verifyRecordMac } from '@/lib/license/record-mac'
import { licenseFailure } from '@/lib/license/failures'
const state = vi.hoisted(() => ({ record: null as Record<string, unknown> | null }))
vi.mock('@/lib/db', () => ({ prisma: { licenseKey: { findUnique: async () => state.record } } }))
vi.mock('@/lib/license/verify', () => ({ verifyLicenseToken: () => ({ valid: true, payload: { lid: 'synthetic-license', typ: 'premium' } }) }))
import { authenticateGarageLicense } from '@/lib/sync/garage-auth'
beforeEach(() => {
  vi.stubEnv('GF_DB_MAC_SECRET', 'm'.repeat(48))
  const fields = { licenseId: 'synthetic-license', token: 'synthetic-token', status: 'active',
    expiryAt: new Date('2099-01-01'), hwid: null }
  state.record = { ...fields, licenseType: 'premium', garageId: 'synthetic-garage', recordMac: computeRecordMac(fields) }
})
afterEach(() => vi.unstubAllEnvs())
it('MAC réel cohérent autorise l’auth sync', async () => {
  expect((await authenticateGarageLicense('synthetic-token')).ok).toBe(true)
})
it('altérer un champ couvert invalide le MAC réel et refuse sync', async () => {
  state.record!.status = 'suspended'
  expect(await authenticateGarageLicense('synthetic-token')).toEqual({ ok: false, code: 'LICENSE_TAMPERED' })
})
it('MAC absent refuse sync', async () => {
  state.record!.recordMac = null
  expect(await authenticateGarageLicense('synthetic-token')).toEqual({ ok: false, code: 'LICENSE_TAMPERED' })
})
it('secret MAC absent : configuration, pas preuve d’altération même si MAC absent', () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('GF_DB_MAC_SECRET', '')
  try {
    verifyRecordMac({ licenseId: 'synthetic', token: 'synthetic', status: 'active', expiryAt: new Date(), hwid: null, recordMac: null })
    throw new Error('configuration must fail')
  } catch (error) { expect(licenseFailure(error)).toEqual({ code: 'SERVER_MISCONFIGURED', status: 500 }) }
})
