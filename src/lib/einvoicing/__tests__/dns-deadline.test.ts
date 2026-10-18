/** Deterministic DNS/fetch simulations; real adapter and SSRF guard, no network. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubmitInvoiceContext } from '../adapter'
const dns = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }))
import { genericPaAdapter } from '../adapters/generic-pa'
const context: SubmitInvoiceContext = {
  garageId: 'synthetic-garage', providerId: 'generic-pa', environment: 'sandbox',
  credentials: { authMode: 'api_key', apiBaseUrl: 'https://platform.example.test', submitPath: '/invoices', statusPath: '/invoices/{id}', apiKeyHeader: 'x-api-key', apiKey: 'synthetic-placeholder' },
  invoiceId: 'synthetic-invoice', idempotencyKey: 'synthetic-idempotency', documentFormat: 'cii', document: new Uint8Array([60, 62]), documentSha256: 'synthetic-digest',
}
beforeEach(() => { vi.useFakeTimers(); dns.lookup.mockReset() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('shared existing 20 second DNS + fetch deadline', () => {
  it('settles a never-completing DNS lookup at the existing deadline with zero fetches', async () => {
    dns.lookup.mockImplementation(() => new Promise(() => {}))
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    let settled = false
    const outcome = genericPaAdapter.submitInvoice(context).then(() => 'unexpected_success', () => { settled = true; return 'rejected' })
    await vi.advanceTimersByTimeAsync(19_999); expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    expect(await outcome).toBe('rejected'); expect(fetcher).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not reset the deadline after 19999ms of DNS resolution', async () => {
    dns.lookup.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([{ address: '93.184.216.34' }]), 19_999)))
    const fetcher = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal('fetch', fetcher)
    let settled = false
    const outcome = genericPaAdapter.submitInvoice(context).then(() => 'unexpected_success', () => { settled = true; return 'rejected' })
    await vi.advanceTimersByTimeAsync(19_999); expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1); expect(settled).toBe(true)
    expect(await outcome).toBe('rejected'); expect(vi.getTimerCount()).toBe(0)
  })
  it('never dispatches after a DNS result arrives late', async () => {
    dns.lookup.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([{ address: '93.184.216.34' }]), 25_000)))
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const outcome = genericPaAdapter.submitInvoice(context).then(() => 'unexpected_success', () => 'rejected')
    await vi.advanceTimersByTimeAsync(20_000)
    // No await of an unsettled old implementation: outcome is inspected after the late reply.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await outcome).toBe('rejected'); expect(fetcher).not.toHaveBeenCalled()
  })
  it('still refuses a DNS answer containing any private address before fetching', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34' }, { address: '10.0.0.7' }])
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(genericPaAdapter.submitInvoice(context)).rejects.toThrow(/non routable/)
    expect(fetcher).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
})
