import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: { user: { id: 'owner-a', role: 'OWNER', garageId: 'garage-a' } },
  partFindMany: vi.fn(async () => { throw new Error('supplier quotes must not query local parts') }),
  purchaseOrderCreate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/api-helpers', () => ({
  withAuth: (handler: unknown) => handler,
  requireSession: async () => h.session,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    part: { findMany: h.partFindMany },
    purchaseOrder: { create: h.purchaseOrderCreate },
    $transaction: h.transaction,
  },
}))
vi.mock('@/lib/security/rate-limit', () => ({ enforceRateLimit: async () => ({ ok: true }) }))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

import { GET, POST } from '../route'

const getRequest = () => new Request('http://localhost/api/suppliers')
const postRequest = (body: unknown) => new Request('http://localhost/api/suppliers', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

beforeEach(() => {
  h.session = { user: { id: 'owner-a', role: 'OWNER', garageId: 'garage-a' } }
  vi.clearAllMocks()
})

describe('supplier production fail-closed guards', () => {
  it('GET returns 501 without reading local cost/stock as a live quote', async () => {
    const response = await GET(getRequest())
    const body = await response.json()
    expect(response.status).toBe(501)
    expect(body.error).toBe('SUPPLIER_INTEGRATION_REQUIRED')
    expect(body).not.toHaveProperty('orders')
    expect(h.partFindMany).not.toHaveBeenCalled()
  })

  it.each([false, true])('create-orders returns 501 for confirm=%s and performs no write', async (confirm) => {
    const response = await POST(postRequest({ action: 'create-orders', confirm }))
    const body = await response.json()
    expect(response.status).toBe(501)
    expect(body.error).toBe('SUPPLIER_INTEGRATION_REQUIRED')
    expect(h.purchaseOrderCreate).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.partFindMany).not.toHaveBeenCalled()
  })

  it('keeps the stock:manage guard ahead of the disabled creation action', async () => {
    h.session = { user: { id: 'receptionist-a', role: 'RECEPTIONIST', garageId: 'garage-a' } }
    const response = await POST(postRequest({ action: 'create-orders', confirm: true }))
    expect(response.status).toBe(403)
    expect(h.purchaseOrderCreate).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })
})
