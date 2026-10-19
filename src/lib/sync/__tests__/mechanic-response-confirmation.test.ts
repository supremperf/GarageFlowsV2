import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ update: vi.fn(), info: vi.fn(), warn: vi.fn() }))
vi.mock('@/lib/db', () => ({ isPostgresDatabase: () => false, prisma: {
  licenseKey: {
    findUnique: async ({ where }: { where: { licenseId: string } }) => where.licenseId === 'fixture-parent'
      ? { licenseType: 'premium', token: 'opaque-parent-fixture', status: 'active' }
      : { licenseId: 'fixture-mechanic', licenseType: 'mechanic', token: 'opaque-mechanic-fixture', garageId: 'garage-fixture', mechanicId: 'mechanic-fixture', parentLicenseId: 'fixture-parent' },
    update: (...args: unknown[]) => state.update(...args),
  },
  garage: { findUnique: async () => ({ id: 'garage-fixture', name: 'Garage fixture' }) },
  mechanic: { findUnique: async () => ({ id: 'mechanic-fixture', name: 'Mechanic fixture', avatar: 'A', color: '#111' }) },
} }))
vi.mock('@/lib/logger', () => ({ logger: { info: (...args: unknown[]) => state.info(...args), warn: (...args: unknown[]) => state.warn(...args) } }))
vi.mock('@/lib/sync/garage-auth', () => ({ shortId: (value: string) => value.slice(0, 8) }))
// Neither the real transport nor the orchestration is mocked.
import { pushMechanicAssignment, pushMechanicStatus } from '../mechanic-sync'

beforeEach(() => { state.update.mockReset().mockResolvedValue({}); state.info.mockClear(); state.warn.mockClear() })
afterEach(() => vi.unstubAllGlobals())
it.each(['assignment', 'revocation'])('%s stays pending on HTTP200 HTML, then confirms only on a real JSON acknowledgement', async mode => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>gateway fixture</html>')))
  const push = () => mode === 'assignment' ? pushMechanicAssignment('fixture-mechanic') : pushMechanicStatus('fixture-mechanic', 'revoked')
  expect(await push()).toEqual({ synced: false, code: 'INVALID_RESPONSE' })
  expect(state.update).not.toHaveBeenCalled()
  expect(state.info).not.toHaveBeenCalled()
  expect(JSON.stringify(state.warn.mock.calls)).not.toContain('gateway fixture')
  expect(JSON.stringify(state.warn.mock.calls)).not.toContain('opaque-parent-fixture')

  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}')))
  expect(await push()).toEqual({ synced: true })
  expect(state.update).toHaveBeenCalledExactlyOnceWith({ where: { licenseId: 'fixture-mechanic' }, data: { cloudSyncedAt: expect.any(Date) } })
})
it('a local sync action never marks cloudSyncedAt on HTTP503 with a positive-looking JSON', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 503 })))
  expect((await pushMechanicStatus('fixture-mechanic', 'revoked')).synced).toBe(false)
  expect(state.update).not.toHaveBeenCalled()
})
