/**
 * Chiffrement des identifiants de plateformes de facturation électronique.
 *
 * AES-256-GCM avec `GF_EINVOICE_CREDENTIALS_KEY` (clé dédiée, SERVEUR uniquement —
 * jamais côté desktop/Electron, jamais dans le frontend, jamais journalisée). La
 * version de clé est conservée dans l'enveloppe pour permettre une rotation
 * CONTRÔLÉE (déchiffrement ancienne clé → rechiffrement nouvelle), voir
 * docs/EINVOICING_SECURITY.md. La clé n'est JAMAIS rotée automatiquement par
 * `RESET-GARAGEFLOW.cmd` (manifeste : autoGenerate=false, autoManage=false).
 *
 * Format d'enveloppe (chaîne opaque, sûre à stocker en base) :
 *   gfeic1.<keyVersion>.<iv_b64url>.<tag_b64url>.<ciphertext_b64url>
 */

import crypto from 'crypto'

const PREFIX = 'gfeic1'
const IV_BYTES = 12 // GCM standard
const KEY_BYTES = 32 // AES-256

export class EInvoiceCipherError extends Error {}

/** Charge et normalise la clé (base64/base64url/hex/UTF-8) en 32 octets exacts. */
function loadKey(): Buffer {
  const raw = process.env.GF_EINVOICE_CREDENTIALS_KEY
  if (!raw || raw.trim().length === 0) {
    throw new EInvoiceCipherError('GF_EINVOICE_CREDENTIALS_KEY absente : chiffrement des identifiants indisponible.')
  }
  const s = raw.trim()
  const candidates: Buffer[] = []
  try { candidates.push(Buffer.from(s, 'base64')) } catch { /* ignore */ }
  if (/^[0-9a-fA-F]{64}$/.test(s)) candidates.push(Buffer.from(s, 'hex'))
  candidates.push(Buffer.from(s, 'utf8'))
  const key = candidates.find((b) => b.length === KEY_BYTES)
  if (!key) {
    throw new EInvoiceCipherError('GF_EINVOICE_CREDENTIALS_KEY invalide : 32 octets requis (AES-256).')
  }
  return key
}

/** Version de clé courante (entier positif ; défaut 1). */
export function currentKeyVersion(): number {
  const v = parseInt(process.env.GF_EINVOICE_CREDENTIALS_KEY_VERSION ?? '1', 10)
  return Number.isInteger(v) && v > 0 ? v : 1
}

function b64u(b: Buffer): string { return b.toString('base64url') }
function unb64u(s: string): Buffer { return Buffer.from(s, 'base64url') }

/** Chiffre une valeur (identifiant/secret de plateforme) → enveloppe opaque. */
export function encryptCredential(plaintext: string, keyVersion = currentKeyVersion()): string {
  const key = loadKey()
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, String(keyVersion), b64u(iv), b64u(tag), b64u(ct)].join('.')
}

/**
 * Déchiffre une enveloppe. `keyForVersion` permet la rotation : fournir la clé
 * historique correspondant à la version stockée. Par défaut, utilise la clé
 * courante (`GF_EINVOICE_CREDENTIALS_KEY`).
 */
export function decryptCredential(envelope: string, keyForVersion?: (v: number) => Buffer): string {
  const parts = envelope.split('.')
  if (parts.length !== 5 || parts[0] !== PREFIX) {
    throw new EInvoiceCipherError('Enveloppe d’identifiant invalide.')
  }
  const [, versionStr, ivS, tagS, ctS] = parts
  const version = parseInt(versionStr, 10)
  const key = keyForVersion ? keyForVersion(version) : loadKey()
  if (key.length !== KEY_BYTES) throw new EInvoiceCipherError('Clé de déchiffrement de longueur invalide.')
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, unb64u(ivS))
    decipher.setAuthTag(unb64u(tagS))
    const pt = Buffer.concat([decipher.update(unb64u(ctS)), decipher.final()])
    return pt.toString('utf8')
  } catch {
    // Ne jamais divulguer la clé ni le détail cryptographique.
    throw new EInvoiceCipherError('Déchiffrement impossible (clé incorrecte ou données altérées).')
  }
}

/** Version de clé encodée dans une enveloppe (pour piloter une migration). */
export function envelopeKeyVersion(envelope: string): number | null {
  const parts = envelope.split('.')
  if (parts.length !== 5 || parts[0] !== PREFIX) return null
  const v = parseInt(parts[1], 10)
  return Number.isInteger(v) && v > 0 ? v : null
}

/** La clé est-elle configurée (sans jamais l'exposer) ? */
export function isCredentialKeyConfigured(): boolean {
  try { loadKey(); return true } catch { return false }
}
