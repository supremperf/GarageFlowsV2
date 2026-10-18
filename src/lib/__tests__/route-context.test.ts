import { describe, it, expect } from 'vitest'
import { resolveRouteContext } from '../route-context'

describe('Next 15 route context boundary', () => {
  it('awaits dynamic params and retains other context properties', async () => {
    const result = await resolveRouteContext({ params: Promise.resolve({ id: 'job-1' }), tenant: 'garage-1' })
    expect(result).toEqual({ params: { id: 'job-1' }, tenant: 'garage-1' })
  })
  it('accepts legacy direct callers and routes without params', async () => {
    expect(await resolveRouteContext({ params: { token: 'signed' } })).toEqual({ params: { token: 'signed' } })
    expect(await resolveRouteContext(undefined)).toBeUndefined()
  })
  it('propagates rejected params rather than executing with an unresolved identifier', async () => {
    await expect(resolveRouteContext({ params: Promise.reject(new Error('bad params')) })).rejects.toThrow('bad params')
  })
})
