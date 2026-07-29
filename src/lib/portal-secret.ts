import { authSecret } from '@/lib/auth-secret'

/**
 * Shared secret for portal + quote-signature JWTs.
 * Uses GF_PORTAL_SECRET when set; otherwise falls back to NEXTAUTH_SECRET
 * (via authSecret(), which throws if NEXTAUTH_SECRET is missing/too short).
 * No hard-coded default secret is ever used.
 */
export function portalSecret(): Uint8Array {
  const raw = process.env.GF_PORTAL_SECRET || authSecret()
  return new TextEncoder().encode(raw)
}
