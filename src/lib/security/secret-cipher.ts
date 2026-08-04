/**
 * Chiffrement au repos des secrets applicatifs stockés en base
 * (mots de passe SMTP, et tout autre secret sensible du même type).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * AES-256-GCM (chiffrement authentifié) :
 *   • nonce (IV) unique par chiffrement — jamais réutilisé ;
 *   • tag d'authentification — toute altération du chiffré fait échouer le
 *     déchiffrement (pas de restitution silencieuse d'une valeur falsifiée) ;
 *   • format VERSIONNÉ et auto-descriptif, préfixé par un marqueur stable
 *     ({@link PREFIX}) qui permet de DÉTECTER un enregistrement déjà chiffré
 *     face à un ancien enregistrement en clair (migration additive) ;
 *   • chaque enregistrement porte un identifiant de clé (`kid`) : la ROTATION
 *     est supportée en fournissant l'ancienne clé via `GF_SMTP_CIPHER_KEY_OLD`
 *     (plusieurs clés séparées par des virgules) — le déchiffrement choisit
 *     automatiquement la bonne clé.
 *
 * Clé : `GF_SMTP_CIPHER_KEY` = 32 octets encodés en base64 (« openssl rand
 * -base64 32 »). AUCUN repli codé en dur : si la clé est absente/faible, le
 * chiffrement échoue proprement (on ne stocke JAMAIS le secret en clair).
 *
 * ⚠️ Ce module n'expose ni la clé ni le secret en clair dans les logs.
 */

import crypto from 'crypto'
import { isWeakSecret } from '@/lib/auth-secret'

/** Marqueur des valeurs chiffrées (détection clair ↔ chiffré). Stable. */
export const PREFIX = 'GFSEC1:'
const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

interface SecretEnvelope {
  v: 1
  alg: 'aes-256-gcm'
  kid: string
  iv: string
  tag: string
  ct: string
}

function decodeKey(b64: string): Buffer {
  const key = Buffer.from(b64, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `Clé de chiffrement invalide : ${KEY_BYTES} octets (base64) requis, ` +
        `décodé ${key.length}. Générez « openssl rand -base64 32 ».`,
    )
  }
  return key
}

/** Identifiant court et non secret d'une clé (pour la rotation). */
function kidOf(key: Buffer): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8)
}

/** La clé de chiffrement des secrets SMTP est-elle configurée (et non faible) ? */
export function secretCipherConfigured(): boolean {
  const raw = process.env.GF_SMTP_CIPHER_KEY?.trim()
  return !!raw && !isWeakSecret(raw)
}

/** Clé primaire (chiffrement). Lève si absente/faible — jamais de repli en dur. */
function primaryKey(): Buffer {
  const raw = process.env.GF_SMTP_CIPHER_KEY?.trim()
  if (!raw) {
    throw new Error(
      'GF_SMTP_CIPHER_KEY absente : impossible de chiffrer les secrets SMTP au repos. ' +
        'Configurez une clé forte (« openssl rand -base64 32 »).',
    )
  }
  if (isWeakSecret(raw)) {
    throw new Error('GF_SMTP_CIPHER_KEY trop courte ou générique — générez « openssl rand -base64 32 ».')
  }
  return decodeKey(raw)
}

/** Toutes les clés candidates au DÉCHIFFREMENT : primaire + anciennes (rotation). */
function decryptionKeys(): Buffer[] {
  const keys: Buffer[] = []
  const primary = process.env.GF_SMTP_CIPHER_KEY?.trim()
  if (primary && !isWeakSecret(primary)) {
    try { keys.push(decodeKey(primary)) } catch { /* ignore une clé mal formée */ }
  }
  const old = process.env.GF_SMTP_CIPHER_KEY_OLD?.trim()
  if (old) {
    for (const part of old.split(',').map((s) => s.trim()).filter(Boolean)) {
      try { keys.push(decodeKey(part)) } catch { /* ignore une clé mal formée */ }
    }
  }
  return keys
}

/** Une valeur stockée est-elle déjà chiffrée par ce module ? */
export function isEncryptedSecret(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.startsWith(PREFIX)
}

/**
 * Chiffre un secret en clair → chaîne stockable (marquée {@link PREFIX}).
 * Lève proprement si la clé est absente/faible (on ne stocke jamais en clair).
 */
export function encryptSecret(plaintext: string): string {
  const key = primaryKey()
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  const env: SecretEnvelope = {
    v: 1,
    alg: ALGO,
    kid: kidOf(key),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  }
  return PREFIX + Buffer.from(JSON.stringify(env), 'utf8').toString('base64')
}

/**
 * Déchiffre une valeur stockée.
 *
 * Rétro-compatibilité : une valeur NON marquée est considérée comme un ancien
 * enregistrement EN CLAIR et renvoyée telle quelle (jusqu'à ce que le script de
 * migration l'ait rechiffrée). Une valeur marquée est déchiffrée avec la clé
 * dont le `kid` correspond ; échec propre (throw) si aucune clé ne convient ou
 * si les données ont été falsifiées.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null) return null
  if (!isEncryptedSecret(stored)) return stored // ancien enregistrement en clair
  let env: SecretEnvelope
  try {
    env = JSON.parse(Buffer.from(stored.slice(PREFIX.length), 'base64').toString('utf8'))
  } catch {
    throw new Error('Secret chiffré illisible (format invalide).')
  }
  // `ct` peut être vide (chiffré d'une chaîne vide) : on teste la PRÉSENCE des
  // champs, pas leur véracité booléenne (iv/tag sont toujours non vides).
  if (!env || env.alg !== ALGO || env.iv == null || env.tag == null || env.ct == null) {
    throw new Error('Secret chiffré illisible (enveloppe incomplète).')
  }
  const candidates = decryptionKeys()
  if (candidates.length === 0) {
    throw new Error('GF_SMTP_CIPHER_KEY absente : impossible de déchiffrer le secret SMTP.')
  }
  const key = candidates.find((k) => kidOf(k) === env.kid)
  if (!key) {
    throw new Error(
      'Aucune clé ne correspond à ce secret (rotation en cours ?). ' +
        'Vérifiez GF_SMTP_CIPHER_KEY et GF_SMTP_CIPHER_KEY_OLD.',
    )
  }
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(env.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(env.ct, 'base64')), decipher.final()]).toString('utf8')
}
