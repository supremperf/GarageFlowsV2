/**
 * API-route integration test for POST /api/quotes/generate.
 *
 * Runs the REAL route handler against a REAL (temporary SQLite) Prisma database,
 * with only the auth layer mocked. Verifies the behaviours that unit tests on
 * the pure engine cannot: confirmation gating (no write on preview), faithful
 * persistence on confirm, garage-scoped client linkage (the IDOR fix), and
 * duplicate-repair-type de-duplication (the double-count fix).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-quotes.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

// Inject a configurable session; withAuth becomes a passthrough.
const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({
  withAuth: (fn: unknown) => fn,
  requireSession: async () => h.session,
}))

let POST: (req: Request) => Promise<Response>
let prisma: any
let garageA: string
let garageB: string
let clientB: string

async function call(body: unknown): Promise<{ status: number; json: any }> {
  const req = new Request('http://localhost/api/quotes/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const res = await POST(req)
  return { status: res.status, json: await res.json() }
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` },
    stdio: 'ignore',
  })

  ;({ prisma } = await import('@/lib/db'))
  ;({ POST } = await import('@/app/api/quotes/generate/route') as any)

  const a = await prisma.garage.create({ data: { name: 'Garage A', slug: 'a', hourlyRate: 60, taxRate: 20 } })
  const b = await prisma.garage.create({ data: { name: 'Garage B', slug: 'b' } })
  garageA = a.id
  garageB = b.id
  const cb = await prisma.client.create({ data: { name: 'Client B', garageId: garageB } })
  clientB = cb.id

  // A default part (BOM) for oil_change in garage A.
  const part = await prisma.part.create({ data: { name: 'Filtre à huile', reference: 'OIL-9', unitPrice: 8, unitCost: 4, garageId: garageA } })
  await prisma.repairTypePart.create({ data: { repairType: 'oil_change', partId: part.id, defaultQty: 1, garageId: garageA } })

  h.session = { user: { id: 'user-a', name: 'Alice', garageId: garageA } }
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('POST /api/quotes/generate (integration)', () => {
  it('previews without writing anything when confirm is absent', async () => {
    const before = await prisma.quote.count({ where: { garageId: garageA } })
    const { status, json } = await call({ repairTypes: ['oil_change'] })
    expect(status).toBe(200)
    expect(json.confirmationRequired).toBe(true)
    expect(json.proposal.lines.length).toBeGreaterThanOrEqual(2) // labour + part
    const after = await prisma.quote.count({ where: { garageId: garageA } })
    expect(after).toBe(before) // no write on preview
  })

  it('persists a draft quote with labour + part lines when confirmed', async () => {
    const { status, json } = await call({ repairTypes: ['oil_change'], confirm: true })
    expect(status).toBe(201)
    expect(json.quote.status).toBe('draft')
    expect(json.quote.number).toMatch(/^DEV-\d{4}-\d{3}$/)
    const labour = json.quote.lines.filter((l: any) => l.isLabor)
    const parts = json.quote.lines.filter((l: any) => !l.isLabor)
    expect(labour).toHaveLength(1)
    expect(parts).toHaveLength(1)
    // 0.5h × 60 = 30 labour ; part 8 → totals reflected in the proposal
    expect(json.proposal.totals.laborHT).toBe(30)
    expect(json.proposal.totals.partsHT).toBe(8)

    const persisted = await prisma.quote.findFirst({ where: { id: json.quote.id }, include: { lines: true } })
    expect(persisted.lines).toHaveLength(2)
  })

  it('drops a clientId that belongs to another garage (tenant isolation)', async () => {
    const { status, json } = await call({ repairTypes: ['oil_change'], clientId: clientB, clientName: 'Walk-in', confirm: true })
    expect(status).toBe(201)
    // Foreign client id must NOT be linked; a free-text name is kept.
    expect(json.quote.clientId).toBeNull()
    expect(json.quote.clientName).toBe('Walk-in')
  })

  it('does not double-count a duplicated repair type', async () => {
    const { json: once } = await call({ repairTypes: ['oil_change'] })
    const { json: twice } = await call({ repairTypes: ['oil_change', 'oil_change'] })
    expect(twice.proposal.totals.subtotalHT).toBe(once.proposal.totals.subtotalHT)
    expect(twice.proposal.lines.length).toBe(once.proposal.lines.length)
  })

  it('rejects an unknown repair type with 400', async () => {
    const { status } = await call({ repairTypes: ['not_a_type'] })
    expect(status).toBe(400)
  })
})
