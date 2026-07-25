/**
 * Shared secret for portal + quote-signature JWTs.
 * Uses GF_PORTAL_SECRET when set; falls back to NEXTAUTH_SECRET so existing
 * tokens issued before the env var was added continue to work.
 */
export function portalSecret(): Uint8Array {
  const raw =
    process.env.GF_PORTAL_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    'fallback-portal-secret-change-in-production'
  return new TextEncoder().encode(raw)
}
