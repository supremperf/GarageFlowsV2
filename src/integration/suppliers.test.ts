/**
 * API-route integration tests for /api/suppliers and saved purchase orders.
 *
 * Supplier quotes and automatic order creation must fail closed until a real
 * supplier integration exists. Existing saved orders still retain their
 * tenant-scoped, confirmation-gated lifecycle and stock effects.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-suppliers.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({ withAuth: (fn: unknown) => fn, requireSession: async () => h.session }))

let GET: (req: Request) => Promise<Response>
let POST: (req: Request) => Promise<Response>
let purchaseOrdersPOST: (req: Request) => Promise<Response>
let prisma: any
let garageA: string
let garageB: string
const ids: Record<string, string> = {}

async function get(qs = ''): Promise<{ status: number; json: any }> {
  const res = await GET(new Request(`http://localhost/api/suppliers${qs}`))
  return { status: res.status, json: await res.json() }
}
async function post(body: unknown): Promise<{ status: number; json: any }> {
  const res = await POST(new Request('http://localhost/api/suppliers', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { status: res.status, json: await res.json() }
}
async function createManualPurchaseOrder(body: unknown): Promise<{ status: number; json: any }> {
  const res = await purchaseOrdersPOST(new Request('http://localhost/api/purchase-orders', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { status: res.status, json: await res.json() }
}

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET, POST } = await import('@/app/api/suppliers/route') as any)
  ;({ POST: purchaseOrdersPOST } = await import('@/app/api/purchase-orders/route') as any)

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id

  const mkPart = async (d: any) => (await prisma.part.create({ data: { garageId: garageA, ...d } })).id
  ids.p1 = await mkPart({ name: 'Plaquettes avant', quantity: 2, minQuantity: 5, unitCostTenThousandths: 200000, unitPriceTenThousandths: 400000, supplierName: 'Oscaro', supplierRef: 'OSC-BRK-01' })
  ids.p5 = await mkPart({ name: 'Courroie', quantity: 20, minQuantity: 3, unitCostTenThousandths: 500000, unitPriceTenThousandths: 1200000, supplierName: 'Oscaro' })
  ids.pRace = await mkPart({ name: 'Amortisseur', quantity: 10, minQuantity: 3, unitCostTenThousandths: 600000, unitPriceTenThousandths: 1300000, supplierName: 'Oscaro' })

  ids.partB = (await prisma.part.create({ data: { garageId: garageB, name: 'Bougie', quantity: 0, minQuantity: 4, unitCostTenThousandths: 30000, unitPriceTenThousandths: 60000, supplierName: 'MisterAuto' } })).id

  const mkPO = async (d: any) => (await prisma.purchaseOrder.create({ data: d })).id
  ids.poSend = await mkPO({ number: 'BC-2026-901', garageId: garageA, supplierName: 'Oscaro', status: 'draft', totalHtCents: 16000, linesJson: JSON.stringify([{ partId: ids.p1, partName: 'Plaquettes avant', qty: 8, unitCost: 20 }]) })
  ids.poRecv = await mkPO({ number: 'BC-2026-902', garageId: garageA, supplierName: 'Oscaro', status: 'sent', sentAt: new Date(), totalHtCents: 40000, linesJson: JSON.stringify([{ partId: ids.p5, partName: 'Courroie', qty: 8, unitCost: 50 }]) })
  ids.poIllegal = await mkPO({ number: 'BC-2026-903', garageId: garageA, supplierName: 'Oscaro', status: 'draft', totalHtCents: 40000, linesJson: '[]' })
  ids.poB = await mkPO({ number: 'BC-2026-001', garageId: garageB, supplierName: 'Oscaro', status: 'draft', totalHtCents: 900, linesJson: '[]' })
  ids.poRace = await mkPO({ number: 'BC-2026-905', garageId: garageA, supplierName: 'Oscaro', status: 'sent', sentAt: new Date(), totalHtCents: 30000, linesJson: JSON.stringify([{ partId: ids.pRace, partName: 'Amortisseur', qty: 5, unitCost: 60 }]) })

  h.session = { user: { id: 'user-a', name: 'Alice', role: 'OWNER', garageId: garageA } }
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('GET /api/suppliers — no synthetic quotes', () => {
  it('returns an explicit unavailable response instead of estimated price/stock/lead time', async () => {
    const before = await prisma.purchaseOrder.count({ where: { garageId: garageA } })
    const { status, json } = await get()
    expect(status).toBe(501)
    expect(json.error).toBe('SUPPLIER_INTEGRATION_REQUIRED')
    expect(json.message).toMatch(/prix.*disponibilit.*délais/i)
    expect(json).not.toHaveProperty('orders')
    expect(await prisma.purchaseOrder.count({ where: { garageId: garageA } })).toBe(before)
  })
})

describe('POST create-orders — no automatic order without a real provider', () => {
  it.each([false, true])('returns 501 for confirm=%s and persists nothing', async (confirm) => {
    const before = await prisma.purchaseOrder.count({ where: { garageId: garageA } })
    const { status, json } = await post({ action: 'create-orders', confirm })
    expect(status).toBe(501)
    expect(json.error).toBe('SUPPLIER_INTEGRATION_REQUIRED')
    expect(await prisma.purchaseOrder.count({ where: { garageId: garageA } })).toBe(before)
  })
})

describe('POST transition — saved order lifecycle + stock effects', () => {
  it('previews a transition without writing', async () => {
    const { json } = await post({ action: 'transition', orderId: ids.poSend, to: 'sent' })
    expect(json.confirmationRequired).toBe(true)
    expect(json.effects.stampSent).toBe(true)
    const po = await prisma.purchaseOrder.findFirst({ where: { id: ids.poSend } })
    expect(po.status).toBe('draft')
  })

  it('confirms draft→sent and stamps sentAt without touching stock', async () => {
    const stockBefore = (await prisma.part.findFirst({ where: { id: ids.p1 } })).quantity
    const { status, json } = await post({ action: 'transition', orderId: ids.poSend, to: 'sent', confirm: true })
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
    const po = await prisma.purchaseOrder.findFirst({ where: { id: ids.poSend } })
    expect(po.status).toBe('sent')
    expect(po.sentAt).not.toBeNull()
    expect((await prisma.part.findFirst({ where: { id: ids.p1 } })).quantity).toBe(stockBefore)
  })

  it('confirms →received and atomically increments part stock, once', async () => {
    const before = (await prisma.part.findFirst({ where: { id: ids.p5 } })).quantity
    const { status } = await post({ action: 'transition', orderId: ids.poRecv, to: 'received', confirm: true })
    expect(status).toBe(200)
    expect((await prisma.part.findFirst({ where: { id: ids.p5 } })).quantity).toBe(before + 8)

    const again = await post({ action: 'transition', orderId: ids.poRecv, to: 'received', confirm: true })
    expect(again.status).toBe(400)
    expect((await prisma.part.findFirst({ where: { id: ids.p5 } })).quantity).toBe(before + 8)
  })

  it('serialises two concurrent receipts: exactly one applies', async () => {
    const before = (await prisma.part.findFirst({ where: { id: ids.pRace } })).quantity
    const [r1, r2] = await Promise.all([
      post({ action: 'transition', orderId: ids.poRace, to: 'received', confirm: true }),
      post({ action: 'transition', orderId: ids.poRace, to: 'received', confirm: true }),
    ])
    const statuses = [r1.status, r2.status].sort()
    expect(statuses[0]).toBe(200)
    expect([400, 409]).toContain(statuses[1])
    expect((await prisma.part.findFirst({ where: { id: ids.pRace } })).quantity).toBe(before + 5)
    expect((await prisma.purchaseOrder.findFirst({ where: { id: ids.poRace } })).status).toBe('received')
  })

  it('rejects an illegal transition (draft→received) even with confirm', async () => {
    const { status } = await post({ action: 'transition', orderId: ids.poIllegal, to: 'received', confirm: true })
    expect(status).toBe(400)
    expect((await prisma.purchaseOrder.findFirst({ where: { id: ids.poIllegal } })).status).toBe('draft')
  })

  it('returns 404 for an order belonging to another garage', async () => {
    const { status } = await post({ action: 'transition', orderId: ids.poB, to: 'sent', confirm: true })
    expect(status).toBe(404)
    expect((await prisma.purchaseOrder.findFirst({ where: { id: ids.poB } })).status).toBe('draft')
  })
})

describe('saved purchase orders — manual, confirmed input only', () => {
  it.each([
    { label: 'empty order', lines: [] },
    { label: 'blank article', lines: [{ partName: '', qty: 1, unitCost: 2 }] },
    { label: 'zero quantity', lines: [{ partName: 'Filtre', qty: 0, unitCost: 2 }] },
    { label: 'fractional stock quantity', lines: [{ partName: 'Filtre', qty: 0.5, unitCost: 2 }] },
  ])('rejects $label without persisting an empty/unreceivable order', async ({ lines }) => {
    const before = await prisma.purchaseOrder.count({ where: { garageId: garageA } })
    const result = await createManualPurchaseOrder({ supplierName: 'Manual', linesJson: lines })
    expect(result.status).toBe(400)
    expect(result.json.code).toBe('INVALID_PURCHASE_ORDER_LINES')
    expect(await prisma.purchaseOrder.count({ where: { garageId: garageA } })).toBe(before)
  })

  it('rejects a part ID from another garage without persisting the order', async () => {
    const before = await prisma.purchaseOrder.count({ where: { garageId: garageA } })
    const result = await createManualPurchaseOrder({
      supplierName: 'Manual',
      linesJson: [{ partId: ids.partB, partName: 'Bougie', qty: 2, unitCost: 3 }],
    })
    expect(result.status).toBe(400)
    expect(result.json.code).toBe('INVALID_PURCHASE_ORDER_PART')
    expect(await prisma.purchaseOrder.count({ where: { garageId: garageA } })).toBe(before)
  })

  it('creates through the saved-order API, then transitions and receives V2 lines', async () => {
    const partId = await (async () => (await prisma.part.create({
      data: { garageId: garageA, name: 'Bobine', quantity: 1, minQuantity: 6, unitCostTenThousandths: 350000, unitPriceTenThousandths: 700000 },
    })).id)()

    const create = await createManualPurchaseOrder({
      supplierName: 'AUD002-Fournisseur',
      linesJson: [{ partId, partName: 'Bobine', qty: 4, unitCost: 35 }],
    })
    expect(create.status).toBe(201)
    const orderId: string = create.json.id

    const stored = await prisma.purchaseOrder.findFirst({ where: { id: orderId, garageId: garageA } })
    const parsed = JSON.parse(stored.linesJson)
    expect(parsed.schemaVersion).toBe(2)
    const before = (await prisma.part.findFirst({ where: { id: partId } })).quantity

    expect((await post({ action: 'transition', orderId, to: 'sent', confirm: true })).status).toBe(200)
    expect((await post({ action: 'transition', orderId, to: 'received', confirm: true })).status).toBe(200)
    expect((await prisma.part.findFirst({ where: { id: partId } })).quantity).toBe(before + 4)
  })
})

describe('authorization and disabled provider behavior', () => {
  const asRole = async <T>(role: string | undefined, fn: () => Promise<T>): Promise<T> => {
    const previous = h.session
    h.session = { user: { id: 'user-b', name: 'Bob', role, garageId: garageA } }
    try { return await fn() } finally { h.session = previous }
  }

  it('RECEPTIONIST may request supplier availability but receives no fabricated quote', async () => {
    const { status, json } = await asRole('RECEPTIONIST', () => get())
    expect(status).toBe(501)
    expect(json.error).toBe('SUPPLIER_INTEGRATION_REQUIRED')
  })

  it.each(['RECEPTIONIST', 'MECHANIC', undefined])('%s cannot create or transition stock orders', async (role) => {
    const { status: createStatus } = await asRole(role, () => post({ action: 'create-orders', confirm: true }))
    expect(createStatus).toBe(403)
    const { status: transitionStatus } = await asRole(role, () =>
      post({ action: 'transition', orderId: ids.poRecv, to: 'received', confirm: true }))
    expect(transitionStatus).toBe(403)
  })

  it.each(['OWNER', 'MANAGER'])('%s passes the write permission but cannot get a simulated order', async (role) => {
    const { status } = await asRole(role, () => post({ action: 'create-orders', confirm: true }))
    expect(status).toBe(501)
  })
})
