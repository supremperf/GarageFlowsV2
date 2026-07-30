/**
 * Shared secret for portal + quote-signature JWTs.
 * Uses GF_PORTAL_SECRET when strong; otherwise NEXTAUTH_SECRET. NO hard-coded
 * fallback — a predictable secret would let anyone forge portal/quote tokens.
 */
import { getPortalSecret } from '@/lib/auth-secret'

export function portalSecret(): Uint8Array {
  return new TextEncoder().encode(getPortalSecret())
}
