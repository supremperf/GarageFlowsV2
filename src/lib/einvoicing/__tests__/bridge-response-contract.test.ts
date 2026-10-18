import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/db', () => ({ isPostgresDatabase: () => false, prisma: {
  licenseKey: { findFirst: async () => ({ token: 'opaque-fixture-parent' }) },
} }))
vi.mock('@/lib/logger', () => ({ logger: { info() {}, warn() {}, error() {} } }))
import { relayerVersCloud } from '../desktop-bridge'
afterEach(() => vi.unstubAllGlobals())
it('real bridge does not forward HTTP200 HTML as success or enrich it with local data', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>fixture gateway error</html>')))
  const enrich = vi.fn((data: Record<string, unknown>) => ({ ...data, localOnly: true }))
  const response = await relayerVersCloud('garage-fixture', 'flags.get', {}, enrich)
  expect(response.status).toBe(502)
  expect(await response.json()).toEqual({ ok: false, code: 'INVALID_RESPONSE' })
  expect(enrich).not.toHaveBeenCalled()
})
it('real bridge preserves provider rejection code/status without enrichment', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":false,"code":"FEATURE_DISABLED"}', { status: 409 })))
  const enrich = vi.fn((data: Record<string, unknown>) => data)
  const response = await relayerVersCloud('garage-fixture', 'flags.get', {}, enrich)
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ ok: false, code: 'FEATURE_DISABLED' })
  expect(enrich).not.toHaveBeenCalled()
})
it('real bridge keeps successful JSON and the existing role-local enrichment path', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true,"flags":{"enabled":true}}')))
  const enrich = vi.fn((data: Record<string, unknown>) => ({ ...data, fixtureRoleAllowed: true }))
  const response = await relayerVersCloud('garage-fixture', 'flags.get', {}, enrich)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, flags: { enabled: true }, fixtureRoleAllowed: true })
  expect(enrich).toHaveBeenCalledOnce()
})
