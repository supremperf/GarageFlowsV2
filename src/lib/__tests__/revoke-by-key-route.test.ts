/** Ancien bypass du limiteur supprimé : même une panne ne peut plus autoriser d'écriture. */
import { it, expect, vi } from 'vitest'
const db = vi.hoisted(() => ({ findUnique: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { licenseKey: db } }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }))
vi.mock('@/lib/security/rate-limit', () => ({
  clientIpFrom: () => 'test',
  enforceRateLimit: () => { throw new Error('limiter unavailable') },
}))
import { POST } from '@/app/api/admin/licenses/revoke-by-key/route'
it.each(['active', 'revoked', 'suspended'])('endpoint retiré : %s impossible même avec ancienne clé', async status => {
  const res = await POST(new Request('https://example.invalid/api/admin/licenses/revoke-by-key', {
    method: 'POST', headers: { 'x-gf-key': 'synthetic-key-not-a-credential' },
    body: JSON.stringify({ licenseId: 'synthetic-license', status }),
  }) as never)
  expect(res.status).toBe(404)
  expect((await res.json()).code).toBe('ENDPOINT_DISABLED')
  for (const method of Object.values(db)) expect(method).not.toHaveBeenCalled()
})
