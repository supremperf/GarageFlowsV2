import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { serializePoLinesJsonV2 } from '@/lib/money-json'

type ReceiveTx = {
  part: {
    findMany: Mock<() => Promise<Array<{ id: string }>>>
    updateMany: Mock<() => Promise<{ count: number }>>
  }
  purchaseOrder: {
    updateMany: Mock<() => Promise<{ count: number }>>
  }
  stockMovement: {
    create: Mock<() => Promise<{ id: string }>>
  }
}

const h = vi.hoisted(() => {
  const tx: ReceiveTx = {
    part: {
      findMany: vi.fn(async () => [{ id: 'part-a' }]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    purchaseOrder: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    stockMovement: {
      create: vi.fn(async () => ({ id: 'movement-a' })),
    },
  }
  return {
    session: { user: { id: 'owner-a', role: 'OWNER', garageId: 'garage-a' } },
    order: {
      id: 'po-a',
      garageId: 'garage-a',
      number: 'BC-2026-001',
      status: 'sent',
      linesJson: '[]',
    },
    orderFindFirst: vi.fn(),
    transaction: vi.fn(async (work: (tx: ReceiveTx) => Promise<unknown>) => work(tx)),
    tx,
  }
})

vi.mock('@/lib/api-helpers', () => ({
  withAuth: (handler: unknown) => handler,
  requireSession: async () => h.session,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    purchaseOrder: { findFirst: h.orderFindFirst },
    $transaction: h.transaction,
  },
}))

import { POST } from '../[id]/receive/route'

const lineJson = (qtyTenThousandths: number, partName = 'Filtre') =>
  serializePoLinesJsonV2([{
    partId: 'part-a',
    partName,
    reference: null,
    qtyTenThousandths,
    unitCostTenThousandths: 0,
    lineTotalCents: 0,
  }])

const makeOrder = (rawLinesJson: string) => ({
  id: 'po-a',
  garageId: 'garage-a',
  number: 'BC-2026-001',
  status: 'sent',
  linesJson: rawLinesJson,
})

const receive = () => POST(
  new Request('http://localhost/api/purchase-orders/po-a/receive', { method: 'POST' }),
  { params: { id: 'po-a' } },
)

beforeEach(() => {
  vi.clearAllMocks()
  h.session = { user: { id: 'owner-a', role: 'OWNER', garageId: 'garage-a' } }
  h.order = makeOrder(lineJson(20_000))
  h.orderFindFirst.mockResolvedValue(h.order)
  h.tx.part.findMany.mockResolvedValue([{ id: 'part-a' }])
  h.tx.part.updateMany.mockResolvedValue({ count: 1 })
  h.tx.purchaseOrder.updateMany.mockResolvedValue({ count: 1 })
  h.transaction.mockImplementation(async (work) => work(h.tx))
})

describe('purchase-order receipt integrity guards', () => {
  it.each([
    { label: 'malformed JSON', input: '{' },
    { label: 'empty order', input: serializePoLinesJsonV2([]) },
    { label: 'blank item', input: lineJson(10_000, '') },
    { label: 'zero quantity', input: lineJson(0) },
    { label: 'fractional stock quantity', input: lineJson(5_000) },
  ])('rejects $label before opening a transaction', async ({ input }) => {
    h.order = makeOrder(input)
    h.orderFindFirst.mockResolvedValue(h.order)
    const response = await receive()
    expect(response.status).toBe(409)
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.tx.purchaseOrder.updateMany).not.toHaveBeenCalled()
    expect(h.tx.part.updateMany).not.toHaveBeenCalled()
  })

  it('does not claim the order when a linked part is absent from this garage', async () => {
    h.tx.part.findMany.mockResolvedValue([])
    const response = await receive()
    const body = await response.json()
    expect(response.status).toBe(409)
    expect(body.code).toBe('PURCHASE_ORDER_RECEIVE_BLOCKED')
    expect(h.tx.part.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['part-a'] }, garageId: 'garage-a' },
      select: { id: true },
    })
    expect(h.tx.purchaseOrder.updateMany).not.toHaveBeenCalled()
    expect(h.tx.part.updateMany).not.toHaveBeenCalled()
    expect(h.tx.stockMovement.create).not.toHaveBeenCalled()
  })

  it('updates only garage-owned stock, journals it, and reports the actual count', async () => {
    const response = await receive()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, stockUpdated: 1 })
    expect(h.tx.purchaseOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'po-a',
        garageId: 'garage-a',
        status: { notIn: ['received', 'cancelled', 'returned'] },
      },
    }))
    expect(h.tx.part.updateMany).toHaveBeenCalledWith({
      where: { id: 'part-a', garageId: 'garage-a' },
      data: { quantity: { increment: 2 } },
    })
    expect(h.tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ garageId: 'garage-a', partId: 'part-a', quantityDelta: 2 }),
    }))
  })

  it('aborts rather than claiming a receipt if a linked part disappears mid-transaction', async () => {
    h.tx.part.updateMany.mockResolvedValue({ count: 0 })
    const response = await receive()
    const body = await response.json()
    expect(response.status).toBe(409)
    expect(body.code).toBe('PURCHASE_ORDER_RECEIVE_BLOCKED')
    expect(h.tx.stockMovement.create).not.toHaveBeenCalled()
  })
})
