/**
 * Single source of truth for the session-signing secret (NEXTAUTH_SECRET).
 *
 * SECURITY: this module NEVER substitutes a hardcoded fallback. Every previous
 * call site had its own committed default constant, which meant that a
 * deployment missing NEXTAUTH_SECRET signed and verified sessions with a
 * publicly-known key (session/admin forgery). Here we FAIL CLOSED instead:
 *  - unset / empty      → throw (no bypass)
 *  - a known legacy default constant → throw (force migration off it)
 *  - anything else      → use it
 *
 * In the packaged Electron app, electron/main.js generates a unique
 * per-installation secret at first run and injects it as NEXTAUTH_SECRET, so
 * this never throws in normal desktop use. In web deployments NEXTAUTH_SECRET
 * MUST be provided.
 *
 * Edge-runtime safe (used by middleware.ts): only process.env + TextEncoder.
 */

/** Legacy hardcoded secrets that were previously shipped in source — refused. */
const REJECTED_SECRETS = new Set([
  'gf-electron-local-secret-2026-xK9mP3qR',
  'fallback-dev-secret-change-in-production',
  'fallback-portal-secret-change-in-production',
])

/** Returns the raw session secret string, or throws when unsafe/unset. */
export function getSessionSecretString(): string {
  const raw = process.env.NEXTAUTH_SECRET
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'NEXTAUTH_SECRET is not set. Refusing to sign/verify sessions with a default key. ' +
        'Set a strong unique NEXTAUTH_SECRET (openssl rand -base64 32).',
    )
  }
  if (REJECTED_SECRETS.has(raw)) {
    throw new Error(
      'NEXTAUTH_SECRET is a known committed default and must not be used. ' +
        'Rotate it to a strong unique value (openssl rand -base64 32).',
    )
  }
  return raw
}

/** Encoded session secret for jose (jwtVerify / SignJWT). */
export function getSessionSecret(): Uint8Array {
  return new TextEncoder().encode(getSessionSecretString())
}

/**
 * Secret for portal + quote-signature JWTs. Uses the dedicated GF_PORTAL_SECRET
 * when provided (recommended, kept distinct from the session secret); otherwise
 * falls back to the (now guaranteed-strong) session secret. Never a constant.
 */
export function getPortalSecret(): Uint8Array {
  const dedicated = process.env.GF_PORTAL_SECRET
  if (dedicated && dedicated.trim().length > 0 && !REJECTED_SECRETS.has(dedicated)) {
    return new TextEncoder().encode(dedicated)
  }
  // No dedicated secret → derive from the session secret (fails closed if unset).
  return getSessionSecret()
}
