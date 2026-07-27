/**
 * Constant-time string comparison for secrets (API keys, shared tokens).
 *
 * A plain `a === b` short-circuits on the first differing byte, leaking length
 * and prefix information through timing. This compares every character so the
 * running time does not depend on where the mismatch is. Pure JS — Edge-safe,
 * no Node `crypto` dependency.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  // Length is not secret here (both are fixed-format keys), but comparing a
  // length-mismatch against `a` keeps the loop count independent of `b`.
  const len = a.length
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}
