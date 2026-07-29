/**
 * Shared secret for portal + quote-signature JWTs.
 *
 * Delegates to the centralized, fail-closed secret resolver. Uses the dedicated
 * GF_PORTAL_SECRET when set (recommended), otherwise the (guaranteed-strong)
 * session secret. NEVER a hardcoded constant — a committed default here would
 * let anyone forge portal tokens and read any garage's data.
 */
import { getPortalSecret } from '@/lib/session-secret'

export function portalSecret(): Uint8Array {
  return getPortalSecret()
}
