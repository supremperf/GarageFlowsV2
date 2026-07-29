/**
 * API-route integration test for GET /api/dashboard.
 *
 * Real route handler over a temporary SQLite database, auth mocked. Verifies the
 * decision-dashboard aggregation end-to-end: a no-data margin renders neutral
 * (not a false "critical"), computed margin/revenue on real invoices, and strict
 * garage scoping (one tenant's data never leaks into another's dashboard).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'node:child_process'
import { format } from 'date-fns'
import path from 'node:path'
import fs from 'node:fs'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-dashboard.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({
  withAuth: (fn: unknown) => fn,
  requireSession: async () => h.session,
}))

/* eslint-disable @typescript-eslint/no-explicit-any */
let GET: (req?: Request) => Promise<Response>
let prisma: any
let garageA: string
let garageB: string

const thisMonth = format(new Date(), 'yyyy-MM')

async function dashboard(): Promise<any> {
  const res = await GET(new Request('http://localhost/api/dashboard'))
  return res.json()
}
const kpi = (dash: any, key: string) => dash.kpis.find((k: any) => k.key === key)

async function paidInvoice(garageId: string, number: string, ht: number, cost: number) {
  await prisma.invoice.create({
    data: {
      number, garageId, clientName: 'C', status: 'paid', issueDate: `${thisMonth}-05`, taxRate: 20,
      lines: { create: [{ description: 'Prestation', quantity: 1, unitPrice: ht, unitCost: cost, isLabor: false, sortOrder: 0 }] },
    },
  })
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` },
    stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET } = await import('@/app/api/dashboard/route') as any)

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('GET /api/dashboard (integration)', () => {
  it('renders a no-data margin as neutral, not a false critical, on a new garage', async () => {
    h.session = { user: { id: 'u', name: 'A', garageId: garageA } }
    const dash = await dashboard()
    const margin = kpi(dash, 'margin')
    expect(margin.status).toBe('neutral') // null margin must NOT be 'critical'
    expect(dash.summary.criticalKpis).toBe(0)
    expect(dash.healthScore).toBeGreaterThanOrEqual(80)
    expect(kpi(dash, 'revenue').value).toBe(0)
  })

  it('computes revenue and margin from real paid invoices', async () => {
    await paidInvoice(garageA, 'FAC-A-1', 1000, 400) // revenue 1000, cost 400 → margin 60%
    h.session = { user: { id: 'u', name: 'A', garageId: garageA } }
    const dash = await dashboard()
    expect(kpi(dash, 'revenue').value).toBe(1000)
    const margin = kpi(dash, 'margin')
    expect(margin.value).toBe(60)
    expect(margin.status).toBe('good') // 60% ≥ warnAt 20
  })

  it('scopes strictly to the session garage (no cross-tenant leakage)', async () => {
    await paidInvoice(garageB, 'FAC-B-1', 5000, 100) // garage B revenue must not appear for A
    h.session = { user: { id: 'ub', name: 'B', garageId: garageB } }
    const dashB = await dashboard()
    expect(kpi(dashB, 'revenue').value).toBe(5000)

    h.session = { user: { id: 'u', name: 'A', garageId: garageA } }
    const dashA = await dashboard()
    expect(kpi(dashA, 'revenue').value).toBe(1000) // still only A's invoice
  })
})
