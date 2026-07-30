/**
 * Bound an external (LLM) call so a hanging provider degrades to the
 * deterministic fallback instead of blocking the request. A rejection (timeout
 * or error) is handled the same as any provider error by the callers.
 */
export const DEFAULT_LLM_TIMEOUT_MS = 8000

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('llm-timeout')), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}
