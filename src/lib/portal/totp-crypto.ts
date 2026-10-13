/**
 * Chiffrement au repos des secrets TOTP du portail — domaine SÉPARÉ (GF-DUR-023).
 *
 * ─── Pourquoi ce module, et pas `security/secret-cipher` ────────────────────
 * La première protection des secrets TOTP réutilisait `GF_SMTP_CIPHER_KEY`. Une
 * seule clé brute servait alors DEUX domaines cryptographiques indépendants :
 * les identifiants SMTP du garage et les seconds facteurs de ses clients. Une
 * rotation SMTP — geste d'exploitation courant, documenté, sans rapport avec le
 * 2FA — rendait du même coup illisibles tous les secrets TOTP. Et une
 * compromission de l'un livrait l'autre.
 *
 * Le dépôt avait d'ailleurs déjà tranché : `GF_TOTP_ENC_KEY` est déclarée au
 * manifeste d'environnement, générée par `configurer-api-garageflow.ps1`,
 * EXCLUE de la rotation automatique de `reset-garageflow.ps1`, et sa perte est
 * documentée dans `ROTATION_SECRETS.md` et `POST_ROTATION_RECOVERY.md`. Le
 * manifeste désigne même ce fichier comme consommateur attendu. Tout était prêt
 * sauf le code.
 *
 * ─── Deux séparations, pas une ──────────────────────────────────────────────
 * Une clé distincte ne suffit pas : si deux domaines partagent un jour la même
 * valeur — copier-coller d'exploitation, environnement mal réglé —, un
 * cryptogramme de l'un se déchiffrerait sous l'autre. Le domaine est donc AUSSI
 * lié cryptographiquement, par les données authentifiées additionnelles (AAD) de
 * GCM. Un cryptogramme SMTP présenté ici échoue à l'authentification, clé
 * identique ou non.
 *
 * ─── Rotation ──────────────────────────────────────────────────────────────
 * `GF_TOTP_ENC_KEY_OLD` accepte plusieurs anciennes clés séparées par des
 * virgules, comme la convention SMTP. Le chiffrement emploie TOUJOURS la clé
 * primaire ; les anciennes ne servent qu'à relire. Sans cela, une rotation
 * verrouillerait tous les comptes protégés — et la seule issue serait la
 * réinscription de chacun.
 */

import crypto from 'crypto'
import { isWeakSecret } from '@/lib/auth-secret'

/** Marqueur de domaine et de version — distinct de celui des secrets SMTP. */
export const PREFIXE_TOTP = 'gtotp1.'

const ALGO = 'aes-256-gcm'
const IV_OCTETS = 12
const CLE_OCTETS = 32

/**
 * Données authentifiées additionnelles : lient le cryptogramme à SON domaine.
 * C'est ce qui rend une confusion SMTP ↔ TOTP impossible même à clé égale.
 */
const AAD = Buffer.from('gf.portal.totp.v1', 'utf8')

function decoderCle(brut: string): Buffer {
  const b = /^[A-Za-z0-9+/]+={0,2}$/.test(brut.trim())
    ? Buffer.from(brut.trim(), 'base64')
    : Buffer.from(brut.trim(), 'utf8')
  if (b.length < CLE_OCTETS) {
    // Une clé plus courte serait complétée en silence par certaines API : on
    // dérive explicitement plutôt que de laisser un doute sur l'entropie réelle.
    return crypto.createHash('sha256').update(b).digest()
  }
  return b.subarray(0, CLE_OCTETS)
}

/** Identifiant court et NON secret d'une clé — permet de nommer la rotation. */
function kid(cle: Buffer): string {
  return crypto.createHash('sha256').update(cle).digest('hex').slice(0, 8)
}

/** La clé de chiffrement des secrets TOTP est-elle configurée, et solide ? */
export function cleTotpConfiguree(): boolean {
  const brut = process.env.GF_TOTP_ENC_KEY?.trim()
  return !!brut && !isWeakSecret(brut)
}

/** Clé PRIMAIRE (chiffrement). Lève plutôt que de retomber sur autre chose. */
function clePrimaire(): Buffer {
  const brut = process.env.GF_TOTP_ENC_KEY?.trim()
  if (!brut) {
    throw new Error(
      'GF_TOTP_ENC_KEY absente : impossible de protéger les secrets TOTP au repos. '
      + 'Générez-la (« openssl rand -base64 32 »). Elle est distincte de GF_SMTP_CIPHER_KEY '
      + 'à dessein : une rotation SMTP ne doit pas verrouiller les comptes à double facteur.',
    )
  }
  if (isWeakSecret(brut)) {
    throw new Error('GF_TOTP_ENC_KEY trop courte ou générique — « openssl rand -base64 32 ».')
  }
  return decoderCle(brut)
}

/** Toutes les clés candidates à la LECTURE : primaire puis anciennes (rotation). */
function clesDeLecture(): Buffer[] {
  const cles: Buffer[] = []
  const primaire = process.env.GF_TOTP_ENC_KEY?.trim()
  if (primaire && !isWeakSecret(primaire)) {
    try { cles.push(decoderCle(primaire)) } catch { /* clé mal formée : ignorée */ }
  }
  const anciennes = process.env.GF_TOTP_ENC_KEY_OLD?.trim()
  if (anciennes) {
    for (const part of anciennes.split(',').map((s) => s.trim()).filter(Boolean)) {
      try { cles.push(decoderCle(part)) } catch { /* idem */ }
    }
  }
  return cles
}

/** La valeur stockée porte-t-elle le marqueur du domaine TOTP ? */
export function estChiffreTotp(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.startsWith(PREFIXE_TOTP)
}

/**
 * Chiffre un secret TOTP → chaîne stockable `gtotp1.<kid>.<iv>.<tag>.<ct>`.
 * Lève si la clé est absente ou faible : on n'écrit jamais en clair.
 */
export function chiffrerSecretTotp(clair: string): string {
  const cle = clePrimaire()
  const iv = crypto.randomBytes(IV_OCTETS)
  const c = crypto.createCipheriv(ALGO, cle, iv)
  c.setAAD(AAD)
  const ct = Buffer.concat([c.update(Buffer.from(clair, 'utf8')), c.final()])
  const tag = c.getAuthTag()
  return [
    PREFIXE_TOTP + kid(cle),
    iv.toString('base64url'),
    tag.toString('base64url'),
    ct.toString('base64url'),
  ].join('.')
}

/**
 * Déchiffre une valeur stockée, ou rend `null`.
 *
 * `null` — et jamais une exception ni une valeur devinée — pour : marqueur
 * absent (clair, ou cryptogramme d'un AUTRE domaine), structure invalide, clé
 * absente, aucune clé ne convenant, authentification GCM en échec. Dans tous ces
 * cas on ne peut pas AFFIRMER connaître le secret.
 */
export function dechiffrerSecretTotp(stocke: string | null | undefined): string | null {
  if (!estChiffreTotp(stocke)) return null

  // `gtotp1.<kid>.<iv>.<tag>.<ct>` — le marqueur porte DÉJÀ un point, le
  // découpage rend donc CINQ segments. Les compter comme quatre rejetait tout,
  // y compris les valeurs que ce module venait d'écrire.
  const parts = (stocke as string).split('.')
  if (parts.length !== 5) return null
  const [, , ivB64, tagB64, ctB64] = parts

  let iv: Buffer, tag: Buffer, ct: Buffer
  try {
    iv = Buffer.from(ivB64, 'base64url')
    tag = Buffer.from(tagB64, 'base64url')
    ct = Buffer.from(ctB64, 'base64url')
  } catch {
    return null
  }
  if (iv.length !== IV_OCTETS || tag.length !== 16) return null

  for (const cle of clesDeLecture()) {
    try {
      const d = crypto.createDecipheriv(ALGO, cle, iv)
      d.setAAD(AAD)
      d.setAuthTag(tag)
      return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
    } catch {
      // Mauvaise clé, ou données altérées : on essaie la suivante.
    }
  }
  return null
}
