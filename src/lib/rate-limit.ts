/**
 * In-memory rate limiter — single process (Electron desktop app).
 *
 * Uses a sliding-window counter keyed by an arbitrary string (IP, user ID, …).
 * Not suitable for multi-process deployments; fine for a local Electron server.
 */

interface Entry {
  count:   number
  resetAt: number  // epoch ms when the window resets
}

const store = new Map<string, Entry>()

// Periodic cleanup to avoid unbounded memory growth (every 10 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    Array.from(store.entries()).forEach(([k, v]) => {
      if (v.resetAt < now) store.delete(k)
    })
  }, 10 * 60 * 1000).unref?.()
}

export interface RateLimitResult {
  ok:          boolean
  remaining:   number
  retryAfter?: number   // seconds until window resets (only present when !ok)
}

/**
 * Check and increment the rate limit counter for `key`.
 *
 * @param key        Unique identifier (e.g. `"activate:127.0.0.1"`)
 * @param max        Max allowed requests in the time window
 * @param windowSec  Window duration in seconds
 */
export function rateLimit(key: string, max: number, windowSec: number): RateLimitResult {
  const now  = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowSec * 1000 })
    return { ok: true, remaining: max - 1 }
  }

  if (entry.count >= max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return { ok: false, remaining: 0, retryAfter }
  }

  entry.count++
  return { ok: true, remaining: max - entry.count }
}

/**
 * Reset the counter for `key` (e.g. after a successful login).
 */
export function resetRateLimit(key: string): void {
  store.delete(key)
}
