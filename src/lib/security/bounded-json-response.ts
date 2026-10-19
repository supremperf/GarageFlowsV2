/** Streaming response reader with explicit budget policy. Infinity is reserved
 * for legacy bulk protocols pending pagination; it is NOT a memory-bound guarantee. */
export type JsonResponseErrorCode = 'INVALID_RESPONSE' | 'RESPONSE_TOO_LARGE' | 'RESPONSE_TOO_FRAGMENTED' | 'TIMEOUT'
export class JsonResponseError extends Error {
  constructor(public readonly code: JsonResponseErrorCode) {
    super(code)
    this.name = 'JsonResponseError'
  }
}
export async function readJsonObject(
  response: Response,
  { maxBytes, maxChunks = 65536, signal }: { maxBytes: number; maxChunks?: number; signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  if (!(maxBytes === Infinity || Number.isSafeInteger(maxBytes) && maxBytes >= 0) || !Number.isSafeInteger(maxChunks) || maxChunks <= 0) throw new JsonResponseError('INVALID_RESPONSE')
  if (signal?.aborted) {
    void response.body?.cancel().catch(() => {})
    throw new JsonResponseError('TIMEOUT')
  }
  const length = response.headers.get('content-length')
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) {
    void response.body?.cancel().catch(() => {})
    throw new JsonResponseError('RESPONSE_TOO_LARGE')
  }
  if (!response.body) throw new JsonResponseError('INVALID_RESPONSE')
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      if (signal?.aborted) throw new JsonResponseError('TIMEOUT')
      const part = await reader.read()
      if (signal?.aborted) throw new JsonResponseError('TIMEOUT')
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > maxBytes) throw new JsonResponseError('RESPONSE_TOO_LARGE')
      if (chunks.length >= maxChunks) throw new JsonResponseError('RESPONSE_TOO_FRAGMENTED')
      // Own the bytes: a custom producer must not mutate a previously enqueued view.
      chunks.push(Uint8Array.from(part.value))
    }
    const buffer = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
    let value: unknown
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) }
    catch { throw new JsonResponseError('INVALID_RESPONSE') }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new JsonResponseError('INVALID_RESPONSE')
    return value as Record<string, unknown>
  } catch (error) {
    cancel()
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}
