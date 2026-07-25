/**
 * Admin API-key authentication for the license admin API
 * (`/api/admin/licenses/*`).
 *
 * The Keygen GUI authenticates to the central server with this key. It is
 * DISTINCT from the session/JWT secret (NEXTAUTH_SECRET): possessing the admin
 * API key must never allow forging a `gf_session` admin cookie, and vice-versa.
 *
 * Uses node:crypto (constant-time comparison) so it must only be imported from
 * Node.js-runtime route handlers, never from Edge middleware.
 */

import crypto from 'crypto'

/** Constant-time string comparison. Returns false on length mismatch. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(String(a), 'utf8')
  const bb = Buffer.from(String(b), 'utf8')
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/** The configured admin API key, or null when the server is misconfigured. */
export function getAdminApiKey(): string | null {
  const k = process.env.LICENSE_ADMIN_API_KEY
  return k && k.trim().length > 0 ? k.trim() : null
}

function extractBearer(req: Request): string | null {
  const h = req.headers.get('authorization')
  if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, '').trim()
  return null
}

/**
 * Read the caller-supplied admin key from either the `x-gf-key` header
 * (Keygen) or a `Authorization: Bearer <key>` header.
 */
export function extractAdminApiKey(req: Request): string {
  return (req.headers.get('x-gf-key') ?? extractBearer(req) ?? '').trim()
}

/**
 * Result of an admin API-key check:
 *  - { ok: true }                         → key present and valid
 *  - { ok: false, status, error }         → misconfigured (500) or invalid (403)
 */
export type ApiKeyCheck = { ok: true } | { ok: false; status: number; error: string }

export function checkAdminApiKey(req: Request): ApiKeyCheck {
  const expected = getAdminApiKey()
  if (!expected) {
    return {
      ok: false,
      status: 500,
      error: 'Configuration serveur incomplète (LICENSE_ADMIN_API_KEY absente).',
    }
  }
  const provided = extractAdminApiKey(req)
  if (!provided || !timingSafeEqualStr(provided, expected)) {
    return { ok: false, status: 403, error: 'Accès refusé — clé API invalide.' }
  }
  return { ok: true }
}
