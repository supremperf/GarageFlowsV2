/**
 * Signed `gf_session` cookie — single implementation with secret rotation.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The license/session state is carried in an HS256-signed JWT stored HttpOnly as
 * `gf_session`. This used to be signed and verified in four different places with
 * three *different* hard-coded fallback secrets, which (a) let anyone forge an
 * admin session and (b) silently broke verification whenever the fallbacks
 * diverged. This module is now the only place that signs or verifies it.
 *
 * Rotation: signing always uses the current key ({@link authSecretKeys}`[0]`);
 * verification accepts every key in the list, so a `NEXTAUTH_SECRET` rotation
 * never logs anyone out mid-session. Edge-runtime safe (jose + Web Crypto only).
 */

import { SignJWT, jwtVerify } from 'jose'
import { authSecretKeys } from '@/lib/env'

/** Claims carried by the signed `gf_session` cookie. */
export interface SessionClaims {
  /** License type / session kind, e.g. `admin`, `premium`, `trial`. */
  typ: string
  /** License id the session is bound to. */
  lid: string
}

/** Default session lifetime — matches the historical 5-year license cookie. */
const DEFAULT_EXPIRATION = '5y'

/** Best-effort de-dup so a rotation notice is logged once per key, not per request. */
const rotationNotified = new Set<number>()

/**
 * Sign a `gf_session` JWT with the current auth secret.
 * @throws {EnvError} when `NEXTAUTH_SECRET` is missing/weak.
 */
export async function signSessionJwt(
  claims: SessionClaims,
  expiration: string = DEFAULT_EXPIRATION,
): Promise<string> {
  const [current] = authSecretKeys()
  return new SignJWT({ typ: claims.typ, lid: claims.lid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(current)
}

/**
 * Verify a `gf_session` JWT against the current key, then any rotation keys.
 * Returns typed claims on success or `null` on any failure (missing, malformed,
 * expired, bad signature). When a token only verifies under an older key, a
 * one-time rotation notice is logged so operators can track the grace window.
 */
export async function verifySessionJwt(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null
  const keys = authSecretKeys()
  for (let i = 0; i < keys.length; i++) {
    try {
      const { payload } = await jwtVerify(token, keys[i])
      if (typeof payload.typ !== 'string' || typeof payload.lid !== 'string') return null
      if (i > 0 && !rotationNotified.has(i)) {
        rotationNotified.add(i)
        // eslint-disable-next-line no-console
        console.warn(
          `[session-jwt] token verified with rotated key #${i} (NEXTAUTH_SECRET_PREVIOUS). ` +
            `Rotation grace window is active; remove old keys once all sessions have expired.`,
        )
      }
      return { typ: payload.typ, lid: payload.lid }
    } catch {
      // Try the next (older) key.
    }
  }
  return null
}
