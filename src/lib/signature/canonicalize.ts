/**
 * Deterministic canonicalization — the foundation of the integrity guarantee.
 *
 * The same logical document MUST always serialize to the exact same string, so
 * that its SHA-256 is stable across processes and re-verifications. We therefore
 * sort object keys recursively and normalize primitives. Any change to a
 * meaningful field changes the output → changes the hash → invalidates the seal.
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

function normalize(value: unknown): Json {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    // Normalize -0 and non-finite to stable forms.
    if (!Number.isFinite(value)) return String(value)
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value === 'boolean' || typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object') {
    const out: { [k: string]: Json } = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = normalize((value as Record<string, unknown>)[key])
    }
    return out
  }
  // Functions, symbols, bigint → stable string form.
  return String(value)
}

/** Canonical, stable JSON string for any JSON-serializable document. */
export function canonicalize(doc: unknown): string {
  return JSON.stringify(normalize(doc))
}
