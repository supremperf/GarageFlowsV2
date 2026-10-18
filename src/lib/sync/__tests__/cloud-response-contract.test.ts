import { afterEach, expect, it, vi } from 'vitest'
import { cloudPost } from '../cloud-client'
vi.mock('@/lib/db', () => ({ isPostgresDatabase: () => false }))
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it.each([
  ['html', '<html>unavailable</html>'], ['malformed', '{'], ['empty', ''],
  ['missing acknowledgement', '{}'], ['array', '[]'], ['scalar', '"ok"'], ['wrong ack type', '{"ok":"true"}'],
])('HTTP200 %s is not an acknowledgement', async (_name, text) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(text, { status: 200 })))
  const result = await cloudPost('/fixture', { fixture: true })
  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.code).toBe('INVALID_RESPONSE')
})
it('keeps explicit success, real status and refusal data without a redirect', async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"ok":true,"id":"fixture"}', { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  expect(await cloudPost('/fixture', { fixture: true })).toMatchObject({ ok: true, status: 200, data: { id: 'fixture' } })
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":false,"code":"PARENT_MISMATCH"}', { status: 409 })))
  expect(await cloudPost('/fixture', {})).toMatchObject({ ok: false, status: 409, code: 'PARENT_MISMATCH' })
})
it('HTTP503 cannot succeed even with a forged positive JSON acknowledgement', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 503 })))
  expect(await cloudPost('/fixture', {})).toMatchObject({ ok: false, status: 503, code: 'INVALID_RESPONSE', data: { ok: false } })
})
it('keeps the full existing maximum 8 MiB photo after base64 expansion', async () => {
  const { MECHANIC_PHOTO_MAX_BYTES } = await import('@/lib/mechanic-photo')
  const { MAX_CLOUD_RESPONSE_BYTES } = await import('../cloud-client')
  const { createHash } = await import('node:crypto')
  const base64 = 'data:image/png;base64,' + Buffer.alloc(MECHANIC_PHOTO_MAX_BYTES).toString('base64')
  const json = JSON.stringify({ ok: true, photo: { id: 'fixture-photo', base64 } })
  expect(Buffer.byteLength(json)).toBeGreaterThan(8 * 1024 * 1024)
  expect(Buffer.byteLength(json)).toBeLessThan(MAX_CLOUD_RESPONSE_BYTES)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(json)))
  const result = await cloudPost('/api/sync/job-photo', {}, 20_000)
  expect(result.ok).toBe(true)
  const returned = (result.data?.photo as { base64: string }).base64
  expect(returned.length).toBe(base64.length)
  expect(createHash('sha256').update(returned).digest('hex')).toBe(createHash('sha256').update(base64).digest('hex'))
})
it('returns a protocol failure and cancels an oversized cloud body', async () => {
  let canceled = false
  const response = new Response(new ReadableStream({ cancel() { canceled = true } }), { headers: { 'content-length': String(32 * 1024 * 1024) } })
  vi.stubGlobal('fetch', vi.fn(async () => response))
  expect(await cloudPost('/api/sync/job-photo', {})).toMatchObject({ ok: false, status: 502, code: 'RESPONSE_TOO_LARGE' })
  expect(canceled).toBe(true)
})
it('retains timeout classification and cancels a stalled body after fetch has resolved', async () => {
  let canceled = false
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel() { canceled = true } }))))
  expect(await cloudPost('/fixture', {}, 40)).toEqual({ ok: false, code: 'TIMEOUT' })
  expect(canceled).toBe(true)
})

it('does not impose the single-item cap on existing bulk proof/history responses', async () => {
  const { MAX_CLOUD_RESPONSE_BYTES } = await import('../cloud-client')
  const piece = 'A'.repeat(1_800_000) // Within the existing 2 MB signature-image limit.
  const json = JSON.stringify({ ok: true, signatures: Array.from({ length: 10 }, (_, i) => ({ id: 'fixture-' + i, signatureData: piece })) })
  expect(Buffer.byteLength(json)).toBeGreaterThan(MAX_CLOUD_RESPONSE_BYTES)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(json)))
  const result = await cloudPost('/api/sync/quote-return', {})
  expect(result.ok).toBe(true)
  expect((result.data?.signatures as unknown[]).length).toBe(10)
})
it('real loopback HTTP200 with an aborted incomplete body remains TIMEOUT, not synced', async () => {
  vi.unstubAllGlobals()
  const http = await import('node:http')
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.write('{')
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected fixture TCP port')
    vi.stubEnv('GF_LICENSE_SERVER', `http://127.0.0.1:${address.port}`)
    vi.stubEnv('GF_ALLOW_INSECURE_SYNC', '1')
    expect(await cloudPost('/fixture', {}, 150)).toEqual({ ok: false, code: 'TIMEOUT' })
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
