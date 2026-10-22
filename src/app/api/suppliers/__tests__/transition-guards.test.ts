import { beforeEach, describe, expect, it, vi } from 'vitest'
import { serializePoLinesJsonV2 } from '@/lib/money-json'

const h = vi.hoisted(() => {
  const tx = {
    part: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    purchaseOrder: { updateMany: vi.fn() },
    stockMovement: { create: vi.fn() },
  }
  return {
    session: { user: { id: 'owner-a', role: 'OWNER', garageId: 'garage-a' } },
    order: {
      id: 'po-a',
      number: 'BC-2026-001',
      status: 'sent',
      linesJson: '[]',
    },
    orderFindFirst: vi.fn(),
    transaction: vi.fn(),
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
vi.mock('@/lib/security/rate-limit', () => ({ enforceRateLimit: async () => ({ ok: true }) }))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

import { POST } from '../route'

const lineJson = (qtyTenThousandths: number, partName = 'Filtre') =>
  serializePoLinesJsonV2([{
    partId: 'part-a',
    partName,
    reference: null,
    qtyTenThousandths,
    unitCostTenThousandths: 0,
    lineTotalCents: 0,
  }])

const makeOrder = (rawLinesJson: string, status = 'sent') => ({
  id: 'po-a',
  number: 'BC-2026-001',
  status,
  linesJson: rawLinesJson,
})

const transition = (to: 'received' | 'returned') => POST(new Request('http://localhost/api/suppliers', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'transition', orderId: 'po-a', to, confirm: true }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  h.session = { user: { id: 'owner-a', role: 'OWNER', garageId: 'garage-a' } }
  h.order = makeOrder(lineJson(20_000))
  h.orderFindFirst.mockResolvedValue(h.order)
  h.tx.part.findMany.mockReset().mockResolvedValue([{ id: 'part-a' }])
  h.tx.part.findFirst.mockReset().mockResolvedValue({ quantity: 1 })
  h.tx.part.updateMany.mockReset().mockResolvedValue({ count: 1 })
  h.tx.purchaseOrder.updateMany.mockReset().mockResolvedValue({ count: 1 })
  h.tx.stockMovement.create.mockReset().mockResolvedValue({ id: 'movement-a' })
  h.transaction.mockReset().mockImplementation(async (work) => work(h.tx))
})

describe('supplier order stock-transition integrity guards', () => {
  it.each([
    { label: 'malformed JSON', input: '{' },
    { label: 'empty order', input: serializePoLinesJsonV2([]) },
    { label: 'blank item', input: lineJson(10_000, '') },
    { label: 'zero quantity', input: lineJson(0) },
    { label: 'fractional quantity', input: lineJson(5_000) },
  ])('rejects $label before claiming a receipt', async ({ input }) => {
    h.order = makeOrder(input)
    h.orderFindFirst.mockResolvedValue(h.order)
    const response = await transition('received')
    const body = await response.json()
    expect(response.status).toBe(409)
    expect(body.code).toMatch(/INVALID_/)
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.tx.purchaseOrder.updateMany).not.toHaveBeenCalled()
  })

  it('does not mark an order received when a linked part is absent from the garage', async () => {
    h.tx.part.findMany.mockResolvedValue([])
    const response = await transition('received')
    const body = await response.json()
    expect(response.status).toBe(409)
    expect(body.code).toBe('PURCHASE_ORDER_PART_UNAVAILABLE')
    expect(h.tx.part.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['part-a'] }, garageId: 'garage-a' },
      select: { id: true },
    })
    expect(h.tx.purchaseOrder.updateMany).not.toHaveBeenCalled()
    expect(h.tx.part.updateMany).not.toHaveBeenCalled()
    expect(h.tx.stockMovement.create).not.toHaveBeenCalled()
  })

  it('increments only garage-owned parts, journals stock and reports the count', async () => {
    const response = await transition('received')
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.stockUpdated).toBe(1)
    expect(h.tx.part.updateMany).toHaveBeenCalledWith({
      where: { id: 'part-a', garageId: 'garage-a' },
      data: { quantity: { increment: 2 } },
    })
    expect(h.tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ garageId: 'garage-a', partId: 'part-a', quantityDelta: 2 }),
    }))
  })

  it('journals the actual clamped decrement on return instead of claiming an unperformed full quantity', async () => {
    h.order = makeOrder(lineJson(20_000), 'received')
    h.orderFindFirst.mockResolvedValue(h.order)
    h.tx.part.updateMany.mockReset()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    h.tx.part.findFirst.mockResolvedValue({ quantity: 1 })
    const response = await transition('returned')
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.stockUpdated).toBe(1)
    expect(h.tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ garageId: 'garage-a', partId: 'part-a', quantityDelta: -1 }),
    }))
  })

  it('aborts the transition when a linked part disappears after the ownership check', async () => {
    h.tx.part.updateMany.mockResolvedValue({ count: 0 })
    const response = await transition('received')
    const body = await response.json()
    expect(response.status).toBe(409)
    expect(body.code).toBe('PURCHASE_ORDER_STOCK_CONFLICT')
    expect(h.tx.stockMovement.create).not.toHaveBeenCalled()
  })
})
