import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ garageId: 'garage-A', findMany: vi.fn(), defaults: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: {
  part: { findMany: (...args: unknown[]) => state.findMany(...args) },
  repairTypePart: { findMany: (...args: unknown[]) => state.defaults(...args) },
} }))
vi.mock('@/lib/api-helpers', () => ({ withAuth: (fn: unknown) => fn,
  requireSession: async () => ({ user: { id: 'fixture-user', garageId: state.garageId, role: 'OWNER' } }),
}))
import { GET } from '@/app/api/parts/route'
const parts = [
  { id: 'part-A', garageId: 'garage-A', name: 'Pièce A', quantity: 4, minQuantity: 2, unitCostTenThousandths: 120000, unitPriceTenThousandths: 200000 },
  { id: 'part-B', garageId: 'garage-B', name: 'Pièce B', quantity: 9, minQuantity: 1, unitCostTenThousandths: 300000, unitPriceTenThousandths: 500000 },
]
const associations = [
  { id: 'default-A', garageId: 'garage-A', part: parts[0], defaultQty: 1 },
  { id: 'legacy-cross-link', garageId: 'garage-A', part: parts[1], defaultQty: 1 },
  { id: 'default-B', garageId: 'garage-B', part: parts[1], defaultQty: 1 },
]
const request = (query = '') => GET(new Request('https://fixture.invalid/api/parts' + query))
beforeEach(() => {
  state.garageId = 'garage-A'
  state.findMany.mockReset().mockImplementation(async ({ where, take, skip }) =>
    parts.filter(p => p.garageId === where.garageId).slice(skip, skip + take))
  state.defaults.mockReset().mockImplementation(async ({ where }) =>
    associations.filter(r => r.garageId === where.garageId && (!where.part?.garageId || r.part.garageId === where.part.garageId)))
})
it.each(['garage-A', 'garage-B'])('catalog scope comes from the %s session, never the client garageId', async (garageId) => {
  state.garageId = garageId
  const result = await (await request('?garageId=attacker&limit=5')).json()
  expect(result).toHaveLength(1)
  expect(result[0].garageId).toBe(garageId)
  expect(result[0].unitPrice).toBe(garageId === 'garage-A' ? 20 : 50)
  expect(state.findMany.mock.calls[0][0].where.garageId).toBe(garageId)
})
it.each(['garage-A', 'garage-B'])('repair-type defaults cannot expose a foreign related part in %s', async (garageId) => {
  state.garageId = garageId
  const result = await (await request('?repairType=oil&garageId=attacker')).json()
  expect(result).toHaveLength(1)
  expect(result[0].part.garageId).toBe(garageId)
  expect(result.some((r: { id: string }) => r.id === 'legacy-cross-link')).toBe(false)
  expect(state.defaults.mock.calls[0][0].where).toMatchObject({ garageId, part: { garageId } })
})
it.each(['page=1.5', 'page=99999999999999999999999', 'page=2147483649&limit=2', 'limit=1.2', 'limit=NaN', 'limit=Infinity', 'limit=0', 'limit=-2', 'page=2oops', 'page=1e5'])('rejects malformed/overflowing pagination before DB: %s', async (query) => {
  const response = await request('?' + query)
  expect(response.status).toBe(400)
  expect((await response.json()).code).toBe('INVALID_PAGINATION')
  expect(state.findMany).not.toHaveBeenCalled()
  expect(state.defaults).not.toHaveBeenCalled()
})
it('preserves default cap and bounded integer pagination for normal requests', async () => {
  await request()
  expect(state.findMany.mock.calls[0][0]).toMatchObject({ take: 5000, skip: 0 })
  await request('?page=2&limit=25')
  expect(state.findMany.mock.calls[1][0]).toMatchObject({ take: 25, skip: 25 })
  await request('?limit=100000')
  expect(state.findMany.mock.calls[2][0].take).toBe(5000)
})
