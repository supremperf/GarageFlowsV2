/**
 * Session-secret resolution — the ONE place the `gf_session` / NextAuth JWT
 * secret is read.
 *
 * Design notes:
 *  - This file is intentionally free of `node:crypto` so it is safe to import
 *    from the Edge middleware (`src/middleware.ts`).
 *  - Every part of the system (middleware, activate route, status route,
 *    api-helpers, Electron main.js) now resolves the secret through the SAME
 *    fallback constant. Previously two different fallback strings were used,
 *    so a token signed by one component failed to verify in another whenever
 *    NEXTAUTH_SECRET was unset. That mismatch is fixed here.
 *  - NEXTAUTH_SECRET MUST be set in production. When it is missing we log a
 *    loud error but still return a deterministic dev fallback so local Electron
 *    runs keep working; the operator is expected to provide the real value.
 *
 * This secret is used ONLY for session/JWT signing. It is deliberately kept
 * separate from the admin API key (see ./api-key.ts) and from the ECC license
 * signing keys (see ../license/public-key.ts).
 */

// Matches the fallback used by electron/main.js so JWTs minted by Electron
// verify on the embedded/central server when NEXTAUTH_SECRET is not provided.
const DEV_SESSION_SECRET = 'gf-electron-local-secret-2026-xK9mP3qR'

export function getSessionSecret(): string {
  const s = process.env.NEXTAUTH_SECRET
  if (s && s.trim().length > 0) return s
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[security] NEXTAUTH_SECRET is not set in production. ' +
        'Set a unique secret (openssl rand -base64 32) — the dev fallback is insecure.',
    )
  }
  return DEV_SESSION_SECRET
}

export function getSessionSecretBytes(): Uint8Array {
  return new TextEncoder().encode(getSessionSecret())
}
