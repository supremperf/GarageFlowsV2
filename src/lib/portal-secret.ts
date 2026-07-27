/**
 * Secrets for the customer-portal and quote-signature JWTs.
 *
 * Signing uses {@link portalSigningKey} (the dedicated `GF_PORTAL_SECRET` when
 * set, otherwise the validated auth secret). Verification uses
 * {@link portalVerifyKeys}, which also accepts rotation history and the auth
 * keys, so links issued before `GF_PORTAL_SECRET` existed — or before a
 * rotation — keep working. No hard-coded fallback secret exists any more: a
 * missing/weak `NEXTAUTH_SECRET` throws via the central validator.
 */

import { jwtVerify, type JWTPayload } from 'jose'
import { portalSigningKey, portalVerifyKeys } from '@/lib/env'

/**
 * Signing key for portal / signature JWTs.
 * @throws {EnvError} when no strong secret is configured.
 */
export function portalSecret(): Uint8Array {
  return portalSigningKey()
}

/**
 * Verify a portal / signature JWT against every accepted key (current, portal
 * rotation history, then auth keys). Returns the payload on success or `null`
 * on any failure — callers decide the HTTP status.
 */
export async function verifyPortalToken(token: string): Promise<JWTPayload | null> {
  for (const key of portalVerifyKeys()) {
    try {
      const { payload } = await jwtVerify(token, key)
      return payload
    } catch {
      // Try the next accepted key.
    }
  }
  return null
}
