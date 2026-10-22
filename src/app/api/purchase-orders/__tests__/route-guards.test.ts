import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: { user: { id: 'owner-a', role: 'OWNER', garageId: 'garage-a' } },
  partFindMany: vi.fn(async () => [] as { id: string }[]),
  transaction: vi.fn(),
}))

vi.mock('@/lib/api-helpers', () => ({
  withAuth: (handler: unknown) => handler,
  requireSession: async () => h.session,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    part: { findMany: h.partFindMany },
    $transaction: h.transaction,
  },
}))

import { POST } from '../route'

const post = (lines: unknown) => POST(new Request('http://localhost/api/purchase-orders', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ supplierName: 'Manual supplier', linesJson: lines }),
}))

beforeEach(() => {
  h.session = { user: { id: 'owner-a', role: 'OWNER', garageId: 'garage-a' } }
  h.partFindMany.mockResolvedValue([])
  vi.clearAllMocks()
})

describe('manual purchase-order creation guards', () => {
  it.each([
    { label: 'empty order', lines: [] },
    { label: 'blank item', lines: [{ partName: '', qty: 1, unitCost: 2 }] },
    { label: 'zero quantity', lines: [{ partName: 'Filter', qty: 0, unitCost: 2 }] },
    { label: 'fractional stock quantity', lines: [{ partName: 'Filter', qty: 0.5, unitCost: 2 }] },
  ])('rejects $label before writing', async ({ lines }) => {
    const response = await post(lines)
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.code).toBe('INVALID_PURCHASE_ORDER_LINES')
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.partFindMany).not.toHaveBeenCalled()
  })

  it('rejects a linked part not owned by the authenticated garage', async () => {
    const response = await post([{ partId: 'foreign-part-id', partName: 'Filter', qty: 2, unitCost: 10 }])
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.code).toBe('INVALID_PURCHASE_ORDER_PART')
    expect(h.partFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['foreign-part-id'] }, garageId: 'garage-a' },
      select: { id: true },
    })
    expect(h.transaction).not.toHaveBeenCalled()
  })
})
