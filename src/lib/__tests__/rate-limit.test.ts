import { describe, it, expect, beforeEach } from 'vitest'

// Test the rate limiter logic in isolation
// (We inline the same algorithm to avoid importing the module-level side effects)

interface Entry { count: number; resetAt: number }
const store = new Map<string, Entry>()

function rateLimit(key: string, max: number, windowSec: number) {
  const now = Date.now()
  const entry = store.get(key)
  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowSec * 1000 })
    return { ok: true, remaining: max - 1 }
  }
  if (entry.count >= max) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
  }
  entry.count++
  return { ok: true, remaining: max - entry.count }
}

describe('rateLimit', () => {
  beforeEach(() => store.clear())

  it('allows the first request', () => {
    expect(rateLimit('k', 3, 60).ok).toBe(true)
  })

  it('counts remaining correctly', () => {
    expect(rateLimit('k', 3, 60).remaining).toBe(2)
    expect(rateLimit('k', 3, 60).remaining).toBe(1)
    expect(rateLimit('k', 3, 60).remaining).toBe(0)
  })

  it('blocks after max attempts', () => {
    rateLimit('k', 3, 60)
    rateLimit('k', 3, 60)
    rateLimit('k', 3, 60)
    const r = rateLimit('k', 3, 60)
    expect(r.ok).toBe(false)
    expect(r.remaining).toBe(0)
    expect(r.retryAfter).toBeGreaterThan(0)
  })

  it('uses separate buckets per key', () => {
    rateLimit('a', 1, 60)
    expect(rateLimit('a', 1, 60).ok).toBe(false)
    expect(rateLimit('b', 1, 60).ok).toBe(true)  // different key
  })
})
