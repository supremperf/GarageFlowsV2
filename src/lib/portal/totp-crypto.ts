/**
 * Chiffrement au repos des secrets TOTP du portail client.
 *
 * Les secrets TOTP (base32) étaient stockés EN CLAIR : une lecture seule de la
 * base fournissait des graines 2FA fonctionnelles. On les chiffre en AES-256-GCM
 * avec une clé DISTINCTE (jamais celle des sessions/JWT directement) :
 *
 *   - Clé dédiée `GF_TOTP_ENC_KEY` (≥32 caractères) si fournie → keyId "k1".
 *   - Sinon dérivée du secret de session via scrypt + sel dédié → keyId "d1".
 *     (séparation cryptographique : ce n'est jamais la clé de session brute).
 *
 * Format versionné (rotation possible via keyId) :
 *   gtotp1.<keyId>.<iv_b64url>.<tag_b64url>.<ciphertext_b64url>
 *
 * Rétro-compatibilité : `decryptTotpSecret` renvoie tel quel une valeur qui
 * n'est PAS au format `gtotp1.` (ancien secret base32 en clair), afin que les
 * comptes 2FA existants continuent de fonctionner (migration paresseuse au 1er
 * usage réussi côté route). Le secret n'est JAMAIS journalisé.
 */
import crypto from 'crypto'
import { getSessionSecretString } from '@/lib/session-secret'
import { isWeakSecret } from '@/lib/auth-secret'

const PREFIX = 'gtotp1'
const SALT = 'GF-TOTP-ENC-v1'

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

/** Résout la clé 32 octets pour un keyId donné. Fail-closed sur secret faible/absent. */
function resolveKey(keyId: string): Buffer {
  if (keyId === 'k1') {
    const raw = process.env.GF_TOTP_ENC_KEY?.trim()
    if (!raw || isWeakSecret(raw)) {
      throw new Error('GF_TOTP_ENC_KEY manquante ou trop faible (clé dédiée requise pour ce format).')
    }
    // Dérive 32 octets déterministes depuis la clé fournie (accepte hex/base64/texte).
    return crypto.scryptSync(raw, SALT + ':k1', 32)
  }
  // keyId "d1" : dérivée du secret de session (distincte via sel dédié).
  const base = getSessionSecretString() // throws si absent / défaut connu
  return crypto.scryptSync(base, SALT + ':d1', 32)
}

/** keyId à utiliser pour un NOUVEAU chiffrement (préfère la clé dédiée si dispo). */
function currentKeyId(): string {
  const raw = process.env.GF_TOTP_ENC_KEY?.trim()
  return raw && !isWeakSecret(raw) ? 'k1' : 'd1'
}

/** Vrai si la valeur stockée est au format chiffré `gtotp1.…`. */
export function isEncryptedTotp(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(PREFIX + '.')
}

/** Chiffre un secret base32 → chaîne `gtotp1.<keyId>.<iv>.<tag>.<ct>`. */
export function encryptTotpSecret(secretBase32: string): string {
  if (typeof secretBase32 !== 'string' || !secretBase32) throw new Error('secret TOTP invalide')
  const keyId = currentKeyId()
  const key = resolveKey(keyId)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, keyId, b64url(iv), b64url(tag), b64url(ct)].join('.')
}

/**
 * Déchiffre une valeur stockée. Rétro-compatible : renvoie la valeur inchangée si
 * elle n'est PAS au format `gtotp1.` (ancien clair). Renvoie null si l'entrée est
 * vide ou si le déchiffrement échoue (clé absente / altération).
 */
export function decryptTotpSecret(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (!isEncryptedTotp(stored)) return stored // legacy clair : compat ascendante
  const parts = stored.split('.')
  if (parts.length !== 5) return null
  const [, keyId, ivB64, tagB64, ctB64] = parts
  try {
    const key = resolveKey(keyId)
    const iv = Buffer.from(ivB64, 'base64url')
    const tag = Buffer.from(tagB64, 'base64url')
    const ct = Buffer.from(ctB64, 'base64url')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
