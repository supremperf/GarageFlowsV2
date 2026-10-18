import { it, expect, vi } from 'vitest'
import { loadLicenseDeviceOverview } from '@/lib/license/devices-overview'
const call = (body: unknown, status = 200) => loadLicenseDeviceOverview(vi.fn(async () => new Response(JSON.stringify(body), { status })))
it('une vraie liste vide n’est ni une panne ni une absence de contexte', async () => {
  expect(await call({ ok: true, seats: 1, activeCount: 0, devices: [] })).toEqual({ seats: 1, activeCount: 0, devices: [] })
})
it.each([401, 404])('HTTP %s : contexte absent explicite', async status => {
  expect(await call({}, status)).toBeNull()
})
it.each([403, 429, 500, 503])('HTTP %s ne devient pas une liste vide', async status => {
  await expect(call({ error: 'sensitive raw detail' }, status)).rejects.toThrow('Liste des postes indisponible')
})
it.each([
  { ok: false }, { ok: true, seats: -1, activeCount: 0, devices: [] },
  { ok: true, seats: 1, activeCount: 0, devices: [null] },
])('HTTP 200 mal formé ou refusé ne devient pas une liste vide', async body => {
  await expect(call(body)).rejects.toThrow('Liste des postes indisponible')
})
it('erreur réseau/JSON ne reflète aucun détail sensible et un nouvel appel peut réussir', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('sensitive raw detail'))
    .mockResolvedValueOnce(new Response('<html>broken', { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, seats: 1, activeCount: 0, devices: [] })))
  await expect(loadLicenseDeviceOverview(fetcher)).rejects.toThrow('Liste des postes indisponible')
  await expect(loadLicenseDeviceOverview(fetcher)).rejects.toThrow('Liste des postes indisponible')
  expect((await loadLicenseDeviceOverview(fetcher))?.activeCount).toBe(0)
})
