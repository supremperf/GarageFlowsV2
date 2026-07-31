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
import { isWeakSecret } from '@/lib/auth-secret'

export function resolveSignatureKey(): Buffer {
  const dedicated = process.env.GF_SIGNATURE_SECRET?.trim()
  // Cohérence avec la politique fail-closed du reste du code (NEXTAUTH_SECRET,
  // DEVICE_TOKEN_PEPPER, GF_BACKUP_KEY) : un secret dédié FAIBLE (trop court /
  // générique) donnerait une clé de scellement d'empreinte prévisible. On LÈVE
  // au lieu de l'accepter — aucun repli silencieux vers une clé faible.
  if (dedicated && isWeakSecret(dedicated)) {
    throw new Error(
      'GF_SIGNATURE_SECRET trop court ou générique — générez un secret fort ' +
        '(« openssl rand -base64 32 »). Aucun repli faible n\'est autorisé.',
    )
  }
  const base = dedicated && dedicated.length > 0
    ? dedicated
    : getSessionSecretString() // throws if unset / a known default
  return crypto.createHmac('sha256', base).update('gf-signature-seal-v1').digest()
}
