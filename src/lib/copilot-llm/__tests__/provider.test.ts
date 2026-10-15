import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnthropicClassifier, DEFAULT_MODEL, __setLlmProvider, providerHealth, resolveLlmProvider } from '../provider'
import { classifyIntent } from '../classify'
import { phraseAnswer } from '../phrase'

const specs = [{ id: 'low_stock', label: 'Stock', keywords: ['stock'] }]
const envelope = (result: unknown) => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }] }))
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); __setLlmProvider(undefined) })
describe('explicit optional provider (simulated transport, not live validation)', () => {
  it('makes no request with only a key or invalid provider setting', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-only-placeholder'); vi.stubEnv('GARAGEFLOW_LLM', 'off')
    expect(resolveLlmProvider()).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
    expect(providerHealth().state).toBe('unavailable')
  })
  it('does not claim ready before an actual validated classification', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ intentId: 'low_stock', confidence: 0.9 })))
    const p = new AnthropicClassifier('test-only-placeholder', DEFAULT_MODEL)
    expect(p.status().state).toBe('initializing')
    expect(await p.classify('stock', specs)).toEqual({ intentId: 'low_stock', confidence: 0.9 })
    expect(p.status().state).toBe('ready')
    expect('phrase' in p).toBe(false)
  })
  it('expires a successful readiness snapshot instead of claiming eternal availability', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ intentId: 'low_stock', confidence: 1 })))
    const p = new AnthropicClassifier('test-only-placeholder', DEFAULT_MODEL)
    await p.classify('stock', specs)
    await vi.advanceTimersByTimeAsync(300001)
    expect(p.status().state).toBe('initializing')
  })
  it('sends only the current query/catalogue, no facts or conversation history', async () => {
    const fetcher = vi.fn(async () => envelope({ intentId: 'low_stock', confidence: 1 })); vi.stubGlobal('fetch', fetcher)
    const p = new AnthropicClassifier('test-only-placeholder', DEFAULT_MODEL)
    await p.classify('stock', specs)
    const [url, opts] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages'); expect(opts.signal).toBeInstanceOf(AbortSignal)
    const body = JSON.parse(opts.body as string)
    expect(body.messages).toEqual([{ role: 'user', content: 'stock' }]); expect(body.tools).toBeUndefined()
    const r = await phraseAnswer({ query: 'q', facts: 'CA 12 €', fallback: 'CA 12 €' }, p)
    expect(r.text).toBe('CA 12 €'); expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([
    { intentId: 'invented', confidence: 1 }, { intentId: 'low_stock', confidence: 3 },
    { intentId: 'low_stock', confidence: '1' }, { intentId: 'low_stock', confidence: 1, endpoint: '/api/delete' },
  ])('degrades safely on invalid model output: %j', async result => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope(result)))
    const p = new AnthropicClassifier('test-only-placeholder', DEFAULT_MODEL)
    expect(await p.classify('stock', specs)).toBeNull(); expect(p.status().state).toBe('degraded')
  })
  it('opens a cooldown circuit on HTTP error without leaking upstream response', async () => {
    const fetcher = vi.fn(async () => new Response('private upstream details', { status: 429 })); vi.stubGlobal('fetch', fetcher)
    const p = new AnthropicClassifier('test-only-placeholder', DEFAULT_MODEL)
    await p.classify('stock', specs); await p.classify('stock', specs)
    expect(fetcher).toHaveBeenCalledTimes(1); expect(JSON.stringify(p.status())).not.toContain('private upstream')
  })
  it('aborts the real request at the deadline, not just a Promise race', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | null = null
    vi.stubGlobal('fetch', vi.fn((_url: string, opts: RequestInit) => new Promise((_resolve, reject) => {
      signal = opts.signal as AbortSignal
      signal.addEventListener('abort', () => reject(new Error('abort')))
    })))
    const p = new AnthropicClassifier('test-only-placeholder', DEFAULT_MODEL)
    const pending = p.classify('stock', specs)
    await vi.advanceTimersByTimeAsync(2501)
    expect(await pending).toBeNull(); expect((signal as unknown as AbortSignal).aborted).toBe(true)
  })
  it('rejects oversized streamed output', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(16385))))
    const p = new AnthropicClassifier('test-only-placeholder', DEFAULT_MODEL)
    expect(await p.classify('stock', specs)).toBeNull()
  })
  it.each([NaN, Infinity, -0.1, 1.1])('rejects invalid provider confidence %s at the generic boundary', async confidence => {
    const r = await classifyIntent('stock', specs, { id: 'scripted', name: 'Scripted', classify: async () => ({ intentId: 'low_stock', confidence }) })
    expect(r.source).toBe('fallback')
  })
})
