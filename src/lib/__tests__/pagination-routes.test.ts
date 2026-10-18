import { it, expect, vi, beforeEach } from 'vitest'
const db = vi.hoisted(() => ({ list: vi.fn(async () => []), count: vi.fn(async () => 0) }))
vi.mock('@/lib/db', () => ({ prisma: Object.fromEntries(['client', 'invoice', 'quote', 'vehicle', 'job'].map(n => [n, { findMany: db.list, count: db.count }])), isPostgresDatabase: () => false }))
vi.mock('@/lib/api-helpers', () => ({
  withAuth: (handler: unknown) => handler,
  requireSession: async () => ({ user: { id: 'fixture', role: 'OWNER', garageId: 'garage-fixture' } }),
}))
vi.mock('@/lib/sync/job-sync', () => ({ pollJobSync: vi.fn(), scheduleJobSync: vi.fn() }))
import { GET as clients } from '@/app/api/clients/route'
import { GET as invoices } from '@/app/api/invoices/route'
import { GET as quotes } from '@/app/api/quotes/route'
import { GET as vehicles } from '@/app/api/vehicles/route'
import { GET as jobs } from '@/app/api/jobs/route'
beforeEach(() => { vi.clearAllMocks() })
for (const [name, handler] of Object.entries({ clients, invoices, quotes, vehicles, jobs })) {
  it.each(['page=abc', 'limit=Infinity', 'page=1000000000&limit=500'])(`${name}: malformed %s returns 400 before any database read`, async query => {
    const result = await handler(new Request(`https://fixture.invalid/api/${name}?${query}`))
    expect(result.status).toBe(400)
    expect((await result.json()).code).toBe('INVALID_PAGINATION')
    expect(db.list).not.toHaveBeenCalled()
    expect(db.count).not.toHaveBeenCalled()
  })
}
