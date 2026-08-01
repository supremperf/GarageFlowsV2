/**
 * Chiffrement au repos du mot de passe SMTP des garages.
 *
 * `Garage.smtpPass` était stocké EN CLAIR : une lecture seule de la base
 * exposait des identifiants d'envoi d'e-mails réutilisables. On le chiffre en
 * AES-256-GCM avec une clé DISTINCTE (jamais la clé de session brute) :
 *
 *   - Clé dédiée `GF_SMTP_CIPHER_KEY` (≥32 caractères) si fournie → keyId "k1".
 *   - Sinon dérivée du secret de session via scrypt + sel dédié → keyId "d1".
 *
 * Format versionné (rotation possible via keyId) :
 *   gsmtp1.<keyId>.<iv_b64url>.<tag_b64url>.<ciphertext_b64url>
 *
 * Rétro-compatibilité : `decryptSmtpPass` renvoie tel quel une valeur qui n'est
 * PAS au format `gsmtp1.` (ancien mot de passe en clair), afin que les
 * configurations existantes continuent d'envoyer des e-mails ; la migration se
 * fait paresseusement (ré-écriture chiffrée au prochain enregistrement ou test).
 * Le mot de passe n'est JAMAIS journalisé ni renvoyé par l'API.
 */
import crypto from 'crypto'
import { getSessionSecretString } from '@/lib/session-secret'
import { isWeakSecret } from '@/lib/auth-secret'

const PREFIX = 'gsmtp1'
const SALT = 'GF-SMTP-ENC-v1'

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

/** Résout la clé 32 octets pour un keyId. Fail-closed sur secret faible/absent. */
function resolveKey(keyId: string): Buffer {
  if (keyId === 'k1') {
    const raw = process.env.GF_SMTP_CIPHER_KEY?.trim()
    if (!raw || isWeakSecret(raw)) {
      throw new Error('GF_SMTP_CIPHER_KEY manquante ou trop faible (clé dédiée requise pour ce format).')
    }
    return crypto.scryptSync(raw, SALT + ':k1', 32)
  }
  // keyId "d1" : dérivée du secret de session (distincte via sel dédié).
  const base = getSessionSecretString() // throws si absent / défaut connu
  return crypto.scryptSync(base, SALT + ':d1', 32)
}

/** keyId à utiliser pour un NOUVEAU chiffrement (préfère la clé dédiée si dispo). */
function currentKeyId(): string {
  const raw = process.env.GF_SMTP_CIPHER_KEY?.trim()
  return raw && !isWeakSecret(raw) ? 'k1' : 'd1'
}

/** Vrai si la valeur stockée est au format chiffré `gsmtp1.…`. */
export function isEncryptedSmtp(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(PREFIX + '.')
}

export type SmtpSecretKind = 'absent' | 'encrypted' | 'plaintext' | 'invalid'

/**
 * Classe une valeur stockée pour distinguer les cas exigés par la migration :
 *  - `absent`    : vide/null (aucun mot de passe configuré) ;
 *  - `encrypted` : format `gsmtp1.` bien formé (5 segments) ;
 *  - `invalid`   : préfixe `gsmtp1.` mais structure cassée (à ré-encrypter) ;
 *  - `plaintext` : toute autre valeur non vide (ancien clair à migrer).
 */
export function classifySmtpSecret(stored: string | null | undefined): SmtpSecretKind {
  if (!stored) return 'absent'
  if (stored.startsWith(PREFIX + '.')) {
    return stored.split('.').length === 5 ? 'encrypted' : 'invalid'
  }
  return 'plaintext'
}

/** Chiffre un mot de passe SMTP → chaîne `gsmtp1.<keyId>.<iv>.<tag>.<ct>`. */
export function encryptSmtpPass(plain: string): string {
  if (typeof plain !== 'string' || !plain) throw new Error('mot de passe SMTP invalide')
  const keyId = currentKeyId()
  const key = resolveKey(keyId)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, keyId, b64url(iv), b64url(tag), b64url(ct)].join('.')
}

/**
 * Déchiffre une valeur stockée. Rétro-compatible : renvoie la valeur inchangée
 * si elle n'est PAS au format `gsmtp1.` (ancien clair). Renvoie null si l'entrée
 * est vide ou si le déchiffrement échoue (clé absente / altération).
 */
export function decryptSmtpPass(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (!isEncryptedSmtp(stored)) return stored // legacy clair : compat ascendante
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

/**
 * Renvoie la forme chiffrée si `stored` est un ancien clair à migrer, sinon
 * `null` (déjà chiffré, absent, ou invalide). Sert à ré-écrire paresseusement
 * une valeur en clair sans jamais toucher aux valeurs déjà chiffrées.
 */
export function reencryptIfLegacy(stored: string | null | undefined): string | null {
  return classifySmtpSecret(stored) === 'plaintext' ? encryptSmtpPass(stored as string) : null
}
