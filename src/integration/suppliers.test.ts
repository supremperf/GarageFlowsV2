/**
 * API-route integration test for /api/suppliers.
 *
 * Real handler over a temporary SQLite DB, auth mocked. Verifies the reorder
 * plan (grouped by supplier, tenant-scoped), confirmation-gated order creation,
 * and the guarded lifecycle state machine with its atomic stock effects.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-suppliers.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({ withAuth: (fn: unknown) => fn, requireSession: async () => h.session }))

let GET: (req: Request) => Promise<Response>
let POST: (req: Request) => Promise<Response>
let prisma: any
let garageA: string
let garageB: string
const ids: Record<string, string> = {}

async function get(qs = ''): Promise<{ status: number; json: any }> {
  const res = await GET(new Request(`http://localhost/api/suppliers${qs}`))
  return { status: res.status, json: await res.json() }
}
async function post(body: unknown): Promise<{ status: number; json: any }> {
  const res = await POST(new Request('http://localhost/api/suppliers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: res.status, json: await res.json() }
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` }, stdio: 'ignore' })
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET, POST } = await import('@/app/api/suppliers/route') as any)

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id

  const mkPart = async (d: any) => (await prisma.part.create({ data: { garageId: garageA, ...d } })).id
  ids.p1 = await mkPart({ name: 'Plaquettes avant', quantity: 2, minQuantity: 5, unitCost: 20, unitPrice: 40, supplierName: 'Oscaro', supplierRef: 'OSC-BRK-01' })
  ids.p2 = await mkPart({ name: 'Disques avant', quantity: 5, minQuantity: 5, unitCost: 45, unitPrice: 90, supplierName: 'Oscaro', supplierRef: 'OSC-DSC-01' }) // qty==min → included
  ids.p3 = await mkPart({ name: 'Filtre a huile', quantity: 1, minQuantity: 4, unitCost: 8, unitPrice: 16, supplierName: 'MisterAuto', supplierRef: 'MA-OIL-09' })
  ids.p4 = await mkPart({ name: 'Essuie-glace', quantity: 20, minQuantity: 6, unitCost: 6, unitPrice: 12, supplierName: 'MisterAuto' }) // NOT low → excluded
  ids.p5 = await mkPart({ name: 'Courroie', quantity: 20, minQuantity: 3, unitCost: 50, unitPrice: 120, supplierName: 'Oscaro' }) // control for receive
  ids.pRace = await mkPart({ name: 'Amortisseur', quantity: 10, minQuantity: 3, unitCost: 60, unitPrice: 130, supplierName: 'Oscaro' }) // control for the concurrency test

  await prisma.part.create({ data: { garageId: garageB, name: 'Bougie', quantity: 0, minQuantity: 4, unitCost: 3, unitPrice: 6, supplierName: 'MisterAuto' } })

  const mkPO = async (d: any) => (await prisma.purchaseOrder.create({ data: d })).id
  ids.poSend = await mkPO({ number: 'BC-2026-901', garageId: garageA, supplierName: 'Oscaro', status: 'draft', totalHT: 160, linesJson: JSON.stringify([{ partId: ids.p1, partName: 'Plaquettes avant', qty: 8, unitCost: 20 }]) })
  ids.poRecv = await mkPO({ number: 'BC-2026-902', garageId: garageA, supplierName: 'Oscaro', status: 'sent', sentAt: new Date(), totalHT: 400, linesJson: JSON.stringify([{ partId: ids.p5, partName: 'Courroie', qty: 8, unitCost: 50 }]) })
  ids.poIllegal = await mkPO({ number: 'BC-2026-903', garageId: garageA, supplierName: 'Oscaro', status: 'draft', totalHT: 400, linesJson: '[]' })
  ids.poB = await mkPO({ number: 'BC-2026-001', garageId: garageB, supplierName: 'Oscaro', status: 'draft', totalHT: 9, linesJson: '[]' })
  ids.poRace = await mkPO({ number: 'BC-2026-905', garageId: garageA, supplierName: 'Oscaro', status: 'sent', sentAt: new Date(), totalHT: 300, linesJson: JSON.stringify([{ partId: ids.pRace, partName: 'Amortisseur', qty: 5, unitCost: 60 }]) })

  h.session = { user: { id: 'user-a', name: 'Alice', garageId: garageA } }
})

afterAll(async () => { await prisma?.$disconnect(); if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH) })

describe('GET /api/suppliers (reorder plan)', () => {
  it('groups low-stock parts by supplier, tenant-scoped, excluding well-stocked parts', async () => {
    const { status, json } = await get()
    expect(status).toBe(200)
    expect(json.scope).toEqual({ targetMultiplier: 2, lowStockParts: 3 })
    expect(json.orders.map((o: any) => o.supplierName)).toEqual(['MisterAuto', 'Oscaro'])
    const allPartIds = json.orders.flatMap((o: any) => o.lines.map((l: any) => l.partId))
    expect(allPartIds).toContain(ids.p1)
    expect(allPartIds).toContain(ids.p2) // qty == minQuantity is included
    expect(allPartIds).not.toContain(ids.p4) // well-stocked excluded
    expect(allPartIds).not.toContain(ids.p5)
    // Garage B's low part never leaks
    expect(json.orders.flatMap((o: any) => o.lines.map((l: any) => l.name))).not.toContain('Bougie')
  })
})

describe('POST create-orders (confirmation-gated)', () => {
  it('previews without persisting any purchase order', async () => {
    const before = await prisma.purchaseOrder.count({ where: { garageId: garageA } })
    const { json } = await post({ action: 'create-orders' })
    expect(json.confirmationRequired).toBe(true)
    expect(json.preview.orders.length).toBe(2)
    expect(await prisma.purchaseOrder.count({ where: { garageId: garageA } })).toBe(before)
  })

  it('persists one draft PO per supplier when confirmed', async () => {
    const { status, json } = await post({ action: 'create-orders', confirm: true })
    expect(status).toBe(201)
    expect(json.created.length).toBe(2)
    for (const c of json.created) {
      const po = await prisma.purchaseOrder.findFirst({ where: { id: c.id } })
      expect(po.status).toBe('draft')
      expect(po.garageId).toBe(garageA)
    }
  })

  it('rejects a targeted order for a foreign part with 400', async () => {
    const foreign = await prisma.part.findFirst({ where: { garageId: garageB } })
    const { status } = await post({ action: 'create-orders', confirm: true, parts: [{ partId: foreign.id, quantity: 3 }] })
    expect(status).toBe(400)
  })
})

describe('POST transition (guarded lifecycle + stock effects)', () => {
  it('previews a transition without writing', async () => {
    const { json } = await post({ action: 'transition', orderId: ids.poSend, to: 'sent' })
    expect(json.confirmationRequired).toBe(true)
    expect(json.effects.stampSent).toBe(true)
    const po = await prisma.purchaseOrder.findFirst({ where: { id: ids.poSend } })
    expect(po.status).toBe('draft') // unchanged
  })

  it('confirms draft→sent and stamps sentAt without touching stock', async () => {
    const stockBefore = (await prisma.part.findFirst({ where: { id: ids.p1 } })).quantity // p1 is on poSend
    const { status, json } = await post({ action: 'transition', orderId: ids.poSend, to: 'sent', confirm: true })
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
    const po = await prisma.purchaseOrder.findFirst({ where: { id: ids.poSend } })
    expect(po.status).toBe('sent')
    expect(po.sentAt).not.toBeNull()
    // Negative control: sending must NOT add stock (only receipt does).
    expect((await prisma.part.findFirst({ where: { id: ids.p1 } })).quantity).toBe(stockBefore)
  })

  it('confirms →received and atomically increments part stock, once', async () => {
    const before = (await prisma.part.findFirst({ where: { id: ids.p5 } })).quantity // 20
    const { status } = await post({ action: 'transition', orderId: ids.poRecv, to: 'received', confirm: true })
    expect(status).toBe(200)
    expect((await prisma.part.findFirst({ where: { id: ids.p5 } })).quantity).toBe(before + 8) // 28

    // Re-receiving is a rejected no-op → no double increment.
    const again = await post({ action: 'transition', orderId: ids.poRecv, to: 'received', confirm: true })
    expect(again.status).toBe(400)
    expect((await prisma.part.findFirst({ where: { id: ids.p5 } })).quantity).toBe(before + 8)
  })

  it('serialises two concurrent receipts via the atomic CAS (one 200, one 409, single increment)', async () => {
    const before = (await prisma.part.findFirst({ where: { id: ids.pRace } })).quantity // 10
    const [r1, r2] = await Promise.all([
      post({ action: 'transition', orderId: ids.poRace, to: 'received', confirm: true }),
      post({ action: 'transition', orderId: ids.poRace, to: 'received', confirm: true }),
    ])
    // The compare-and-swap (updateMany where status='sent') lets exactly one win.
    expect([r1.status, r2.status].sort()).toEqual([200, 409])
    // Stock incremented exactly once despite two concurrent confirms.
    expect((await prisma.part.findFirst({ where: { id: ids.pRace } })).quantity).toBe(before + 5)
  })

  it('rejects an illegal transition (draft→received) even with confirm', async () => {
    const { status } = await post({ action: 'transition', orderId: ids.poIllegal, to: 'received', confirm: true })
    expect(status).toBe(400)
    expect((await prisma.purchaseOrder.findFirst({ where: { id: ids.poIllegal } })).status).toBe('draft')
  })

  it('returns 404 for an order belonging to another garage (tenant isolation)', async () => {
    const { status } = await post({ action: 'transition', orderId: ids.poB, to: 'sent', confirm: true })
    expect(status).toBe(404)
    expect((await prisma.purchaseOrder.findFirst({ where: { id: ids.poB } })).status).toBe('draft') // untouched
  })
})
