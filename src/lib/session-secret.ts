/**
 * Single source of truth for the HS256 `gf_session` cookie signing secret
 * (the license/admin session cookie set by /api/license/activate, verified by
 * the middleware and by isAdminSession()).
 *
 * SECURITY — fail-closed in production:
 *  In production the secret MUST come from the environment (NEXTAUTH_SECRET).
 *  We deliberately never fall back to a hardcoded constant in production: a
 *  value shipped in the source tree is public, and anyone could use it to forge
 *  an admin `gf_session` cookie (privilege escalation → license management).
 *
 *  The packaged Electron app always injects NEXTAUTH_SECRET before spawning the
 *  bundled Next.js server (see electron/main.js), so this throw only fires on a
 *  genuinely misconfigured *server* deployment — exactly where fail-closed is
 *  the safe behaviour.
 *
 *  Using ONE resolver everywhere also removes a latent bug: previously the
 *  signer (activate) and the verifiers (middleware / isAdminSession) used
 *  *different* hardcoded fallbacks, so an env-less deploy would sign and verify
 *  with mismatched secrets.
 *
 * Edge-runtime safe: only reads process.env and uses TextEncoder.
 */

// Deterministic secret used ONLY outside production (local `next dev`, tests).
// Never reached in production or in the packaged Electron app.
const DEV_ONLY_FALLBACK = 'gf-electron-local-secret-2026-xK9mP3qR'

export function getSessionSecretString(): string {
  const s = process.env.NEXTAUTH_SECRET
  if (s && s.length > 0) return s

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[session-secret] NEXTAUTH_SECRET is not set. Refusing to use a hardcoded ' +
        'fallback in production — it would allow admin-session forgery. Set ' +
        'NEXTAUTH_SECRET to a strong random value (openssl rand -base64 32).'
    )
  }

  return DEV_ONLY_FALLBACK
}

export function getSessionSecret(): Uint8Array {
  return new TextEncoder().encode(getSessionSecretString())
}
