/**
 * API-route integration test for POST /api/copilot.
 *
 * Real handler over a temporary SQLite DB, auth mocked. Verifies that read
 * intents answer from garage-scoped data, that action intents are confirmation-
 * gated and write NOTHING, and that the grounded `phrasing` field is present on
 * answers (== message with no provider) and absent on the action pass-through.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { toScaled } from '@/lib/money'
import { execSync } from 'node:child_process'
import { format, subDays } from 'date-fns'
import path from 'node:path'
import fs from 'node:fs'
import { __setLlmProvider } from '@/lib/copilot-llm/provider'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-copilot.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({ withAuth: (fn: unknown) => fn, requireSession: async () => h.session }))

let POST: (req: Request) => Promise<Response>
let prisma: any
let garageA: string
let garageB: string
const today = format(new Date(), 'yyyy-MM-dd')

async function ask(query: string): Promise<{ status: number; json: any }> {
  const res = await POST(new Request('http://localhost/api/copilot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) }))
  return { status: res.status, json: await res.json() }
}
// Rôle OWNER : ces tests exercent la LOGIQUE des résolveurs (scoping garage,
// grounding) ; l'accès aux résolveurs financiers exige financial:read (cf. le
// test d'autorisation dédié copilot-financial-authz-v15).
const asA = () => { h.session = { user: { id: 'ua', name: 'A', role: 'OWNER', garageId: garageA } } }

async function paidInvoice(garageId: string, number: string, issueDate: string, status: string, ht: number) {
  await prisma.invoice.create({ data: { number, garageId, clientName: 'C', status, issueDate, taxRate: 20, lines: { create: [{ description: 'x', quantityTenThousandths: 10000, unitPriceTenThousandths: toScaled(ht), unitCostTenThousandths: 0, isLabor: false, sortOrder: 0 }] } } })
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` }, stdio: 'ignore' })
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST } = await import('@/app/api/copilot/route') as any)

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id

  // revenue_today: only a today+paid+garageA invoice counts.
  await paidInvoice(garageA, 'FAC-A-1', today, 'paid', 250)
  await paidInvoice(garageA, 'FAC-A-YEST', format(subDays(new Date(), 1), 'yyyy-MM-dd'), 'paid', 999) // wrong day
  await paidInvoice(garageA, 'FAC-A-DRAFT', today, 'draft', 500) // wrong status
  await paidInvoice(garageB, 'FAC-B-1', today, 'paid', 777) // wrong garage

  // low_stock: one below-min part, one well-stocked, one in garage B. NO JobParts
  // (zero consumption keeps the reorder figures deterministic).
  await prisma.part.create({ data: { name: 'Plaquettes', reference: 'BRK-1', quantity: 2, minQuantity: 5, unitCostTenThousandths: 100000, garageId: garageA } })
  await prisma.part.create({ data: { name: 'Ampoule', quantity: 100, minQuantity: 5, unitCostTenThousandths: 10000, garageId: garageA } })
  await prisma.part.create({ data: { name: 'CrossTenant', quantity: 0, minQuantity: 5, unitCostTenThousandths: 500000, garageId: garageB } })

  asA()
})

afterAll(async () => { await prisma?.$disconnect(); if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH) })

describe('POST /api/copilot', () => {
  it('answers revenue_today from garage-scoped, date/status-filtered data', async () => {
    const { status, json } = await ask('Quel est le CA du jour ?')
    expect(status).toBe(200)
    expect(json.type).toBe('answer')
    expect(json.data.revenueHT).toBe(250) // yesterday/draft/other-garage all excluded
    expect(json.data.invoiceCount).toBe(1)
    expect(json.phrasing).toBe(json.message) // no provider → grounded fallback == message
  })

  it('scopes revenue strictly to the session garage', async () => {
    h.session = { user: { id: 'ub', name: 'B', role: 'OWNER', garageId: garageB } }
    const { json } = await ask('Quel est le CA du jour ?')
    expect(json.data.revenueHT).toBe(777) // B sees only its own row
    asA()
    const back = await ask('Quel est le CA du jour ?')
    expect(back.json.data.revenueHT).toBe(250)
  })

  it('answers low_stock with the reorder plan (deterministic, zero consumption)', async () => {
    const { json } = await ask('Quelles pièces sont en rupture de stock ?')
    expect(json.type).toBe('answer')
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.data).toHaveLength(1) // only the below-min garage-A part
    expect(json.data[0].shouldReorder).toBe(true)
    expect(json.data[0].urgency).toBe('critical')
    expect(json.phrasing).toBe(json.message)
  })

  it('gates an action intent behind confirmation and writes NOTHING', async () => {
    const before = await prisma.quote.count({ where: { garageId: garageA } })
    const { status, json } = await ask('Crée un devis pour ce client')
    expect(status).toBe(200)
    expect(json.type).not.toBe('answer') // action pass-through, not a data answer
    expect(JSON.stringify(json)).toMatch(/confirm/i) // confirmation required
    expect('phrasing' in json).toBe(false) // phrasing is only added on the answer path
    expect(await prisma.quote.count({ where: { garageId: garageA } })).toBe(before) // no write
  })

  it('returns unknown for an unrecognised query (no phrasing, no write)', async () => {
    const { json } = await ask('blablabla xyz 123')
    expect(json.type).toBe('unknown')
    expect('phrasing' in json).toBe(false)
  })
})

describe('POST /api/copilot — grounding guard through the route', () => {
  afterEach(() => __setLlmProvider(null)) // restore the default (no provider)

  it('rejects a fabricated figure from a provider and keeps the deterministic message', async () => {
    asA()
    __setLlmProvider({ id: 'x', name: 'X', phrase: async () => 'Vous avez encaissé 9999 € aujourd’hui !' })
    const { json } = await ask('Quel est le CA du jour ?')
    expect(json.phrasing).toBe(json.message) // ungrounded → falls back
    expect(json.phrasing).not.toMatch(/9999/) // the invented figure never surfaces
  })

  it('passes a grounded provider rephrase through unchanged', async () => {
    asA()
    __setLlmProvider({ id: 'x', name: 'X', phrase: async () => 'Aujourd’hui : 250 € encaissés sur 1 facture.' })
    const { json } = await ask('Quel est le CA du jour ?')
    expect(json.phrasing).not.toBe(json.message) // grounded → the rephrase is used
    expect(json.phrasing).toMatch(/250/)
  })
})
