/**
 * Shared secret for portal + quote-signature JWTs.
 *
 * Prefers GF_PORTAL_SECRET, then NEXTAUTH_SECRET (so tokens issued before the
 * dedicated var existed keep working).
 *
 * SECURITY — fail-closed in production: never fall back to a hardcoded constant
 * in production. A shipped secret would let anyone mint valid portal/signature
 * tokens (customer-data disclosure, forged quote signatures). The packaged
 * Electron app always injects NEXTAUTH_SECRET, so the throw only fires on a
 * misconfigured server deployment.
 */
const DEV_ONLY_FALLBACK = 'gf-portal-dev-only-fallback'

export function portalSecret(): Uint8Array {
  const raw = process.env.GF_PORTAL_SECRET ?? process.env.NEXTAUTH_SECRET

  if (raw && raw.length > 0) {
    return new TextEncoder().encode(raw)
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[portal-secret] Neither GF_PORTAL_SECRET nor NEXTAUTH_SECRET is set. ' +
        'Refusing to sign/verify portal tokens with a hardcoded fallback in ' +
        'production — it would allow token forgery.'
    )
  }

  return new TextEncoder().encode(DEV_ONLY_FALLBACK)
}
