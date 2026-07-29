/**
 * Resolve the per-installation HMAC key used to seal signatures.
 *
 * Prefers a dedicated GF_SIGNATURE_SECRET; otherwise derives a distinct key from
 * the (fail-closed) session secret so it is unique per install and never a
 * committed constant. Derivation keeps it independent from the session-signing
 * key even when no dedicated secret is configured.
 */
import crypto from 'crypto'
import { getSessionSecretString } from '@/lib/session-secret'

export function resolveSignatureKey(): Buffer {
  const dedicated = process.env.GF_SIGNATURE_SECRET
  const base =
    dedicated && dedicated.trim().length > 0
      ? dedicated
      : getSessionSecretString() // throws if unset / a known default
  return crypto.createHmac('sha256', base).update('gf-signature-seal-v1').digest()
}
