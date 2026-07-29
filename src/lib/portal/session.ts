/**
 * Portal customer session — signed JWT, rotation-aware.
 *
 * Reuses the Phase-1 portal secret infrastructure ({@link portalSigningKey} /
 * {@link portalVerifyKeys}), so portal sessions inherit secret rotation and the
 * "no hard-coded fallback" guarantee. The token carries the portal user id
 * (`sub`) and a per-device session id (`sid`), which maps to a PortalDevice row
 * for the "connected devices" / global-logout feature.
 */

import { SignJWT, jwtVerify } from 'jose'
import { portalSigningKey, portalVerifyKeys } from '@/lib/env'

const TOKEN_TYPE = 'portal-session'

export interface PortalSessionClaims {
  /** PortalUser id. */
  sub: string
  /** PortalDevice.sessionId. */
  sid: string
}

/** Sign a portal session token (default 7-day lifetime). */
export async function signPortalSession(claims: PortalSessionClaims, expiration = '7d'): Promise<string> {
  return new SignJWT({ sid: claims.sid, typ: TOKEN_TYPE })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(portalSigningKey())
}

/** Verify a portal session token against every accepted key (rotation-aware). */
export async function verifyPortalSession(token: string | undefined | null): Promise<PortalSessionClaims | null> {
  if (!token) return null
  for (const key of portalVerifyKeys()) {
    try {
      const { payload } = await jwtVerify(token, key)
      if (payload.typ !== TOKEN_TYPE) return null
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null
      return { sub: payload.sub, sid: payload.sid }
    } catch {
      // Try the next accepted key.
    }
  }
  return null
}

const CHALLENGE_TYPE = 'portal-2fa'

/**
 * Short-lived token issued after a correct password when 2FA is enabled. It
 * proves the password step succeeded and must be presented to the 2FA-verify
 * endpoint to obtain a full session. 5-minute lifetime.
 */
export async function signTwoFactorChallenge(portalUserId: string): Promise<string> {
  return new SignJWT({ typ: CHALLENGE_TYPE })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(portalUserId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(portalSigningKey())
}

/** Verify a 2FA challenge token; returns the portal user id or null. */
export async function verifyTwoFactorChallenge(token: string | undefined | null): Promise<string | null> {
  if (!token) return null
  for (const key of portalVerifyKeys()) {
    try {
      const { payload } = await jwtVerify(token, key)
      if (payload.typ === CHALLENGE_TYPE && typeof payload.sub === 'string') return payload.sub
      return null
    } catch {
      // Try the next accepted key.
    }
  }
  return null
}
