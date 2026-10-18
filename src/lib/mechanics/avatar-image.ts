/**
 * Photo de profil mécanicien — validation et nettoyage, côté SERVEUR.
 *
 * ─── Ce que ce module garantit ──────────────────────────────────────────────
 *  1. Le type est celui des OCTETS, jamais celui annoncé par le navigateur.
 *  2. Le fichier est structurellement une image : ses dimensions sont lues dans
 *     son en-tête. Un exécutable renommé `photo.jpg`, un HTML renommé `.png`,
 *     un SVG (qui peut porter du script), un fichier vide ou tronqué n'ont pas
 *     d'en-tête exploitable et sont refusés.
 *  3. Les dimensions sont bornées : une image de 20 000 × 20 000 pixels est
 *     refusée avant tout traitement (« bombe de décompression »).
 *  4. Les métadonnées sont RETIRÉES pour le JPEG — y compris la position GPS.
 *     La photo d'un mécanicien ne doit pas révéler où elle a été prise.
 *
 * ─── Ce que ce module NE fait PAS, et pourquoi ──────────────────────────────
 * Il ne DÉCODE ni ne redimensionne l'image : `sharp` n'est qu'une dépendance de
 * développement du projet, et l'introduire dans le chemin d'exécution du serveur
 * ajouterait un binaire natif au bundle Electron comme au déploiement cloud —
 * un changement d'empaquetage qui ne peut pas être vérifié ici.
 *
 * La miniature est donc produite par le NAVIGATEUR (voir `avatar-client.ts`),
 * qui ré-encode l'image sur un canvas : l'opération applique l'orientation EXIF
 * et fait disparaître toutes les métadonnées par construction. Le serveur ne lui
 * fait pas confiance pour autant — il revalide type, structure, dimensions et
 * taille, et re-nettoie le JPEG. Le client optimise ; le serveur décide.
 *
 * Limite assumée et consignée : sans décodeur, un fichier au bon en-tête mais au
 * contenu corrompu en profondeur peut être accepté et s'afficher cassé chez le
 * client — auquel cas `MechanicAvatar` retombe sur les initiales. Aucune
 * exécution de code n'en découle.
 */

import crypto from 'crypto'

/** Taille maximale acceptée par le serveur, après optimisation navigateur. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024

/** Côté maximal accepté. Au-delà, l'image n'a pas été optimisée. */
export const AVATAR_MAX_DIMENSION = 4096

/** Côté minimal : en dessous, la pastille du planning serait floue. */
export const AVATAR_MIN_DIMENSION = 32

/** Côté de la miniature produite par le navigateur. */
export const AVATAR_THUMBNAIL_SIZE = 256

/** Types réellement acceptés pour un avatar. */
export const AVATAR_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AvatarMime = (typeof AVATAR_MIMES)[number]

export type AvatarValidation =
  | { ok: true; mime: AvatarMime; bytes: Buffer; width: number; height: number; hash: string }
  | { ok: false; reason: string }

// ─── Lecture des dimensions dans l'en-tête ───────────────────────────────────

/** Dimensions d'un PNG : IHDR, en tête de fichier. */
function dimensionsPng(buf: Buffer): { width: number; height: number } | null {
  // Signature (8) + longueur (4) + « IHDR » (4) + largeur (4) + hauteur (4)
  if (buf.length < 24) return null
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/**
 * Dimensions d'un JPEG : parcours des marqueurs jusqu'au segment SOF.
 *
 * C'est ce parcours qui donne la validation STRUCTURELLE : un fichier qui
 * commence par les octets magiques d'un JPEG mais n'est pas un JPEG n'a pas de
 * chaîne de marqueurs cohérente et n'atteint jamais son SOF.
 */
function dimensionsJpeg(buf: Buffer): { width: number; height: number } | null {
  let p = 2 // saute SOI (FF D8)
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) return null // chaîne de marqueurs rompue
    const marqueur = buf[p + 1]
    // Marqueurs sans charge utile.
    if (marqueur === 0xd8 || marqueur === 0x01 || (marqueur >= 0xd0 && marqueur <= 0xd7)) { p += 2; continue }
    if (marqueur === 0xd9 || marqueur === 0xda) return null // fin / début de données : pas de SOF
    const longueur = buf.readUInt16BE(p + 2)
    if (longueur < 2) return null
    // SOF0-3, SOF5-7, SOF9-11, SOF13-15 (on exclut DHT=C4, JPG=C8, DAC=CC).
    const estSof = marqueur >= 0xc0 && marqueur <= 0xcf
      && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc
    if (estSof) {
      if (p + 9 > buf.length) return null
      return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) }
    }
    p += 2 + longueur
  }
  return null
}

/** Dimensions d'un WebP : conteneur RIFF, variantes VP8 / VP8L / VP8X. */
function dimensionsWebp(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null
  const type = buf.toString('ascii', 12, 16)

  if (type === 'VP8X') {
    // Largeur et hauteur sur 24 bits, moins un.
    return {
      width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
      height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
    }
  }
  if (type === 'VP8 ') {
    // Trame clé : code de départ 9D 01 2A, puis largeur/hauteur sur 14 bits.
    const s = buf.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20)
    if (s === -1 || s + 7 > buf.length) return null
    return {
      width: buf.readUInt16LE(s + 3) & 0x3fff,
      height: buf.readUInt16LE(s + 5) & 0x3fff,
    }
  }
  if (type === 'VP8L') {
    if (buf[20] !== 0x2f || buf.length < 25) return null
    const bits = buf.readUInt32LE(21)
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
    }
  }
  return null
}

/** Type réel d'après les octets magiques — jamais l'en-tête `data:` annoncé. */
export function typeReel(buf: Buffer): AvatarMime | null {
  if (buf.length < 16) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** Dimensions d'une image de type connu, ou `null` si l'en-tête est incohérent. */
export function dimensionsImage(buf: Buffer, mime: AvatarMime): { width: number; height: number } | null {
  const d = mime === 'image/png' ? dimensionsPng(buf)
    : mime === 'image/jpeg' ? dimensionsJpeg(buf)
    : dimensionsWebp(buf)
  if (!d) return null
  if (!Number.isFinite(d.width) || !Number.isFinite(d.height) || d.width <= 0 || d.height <= 0) return null
  return d
}

// ─── Retrait des métadonnées ─────────────────────────────────────────────────

/**
 * Retire TOUS les segments applicatifs et commentaires d'un JPEG.
 *
 * `APP1` porte l'EXIF — dont la position GPS de la prise de vue — et le XMP ;
 * `APP2` le profil ICC ; `APP13` les données Photoshop/IPTC. Aucun n'est
 * nécessaire à l'affichage d'une pastille de 28 pixels, et l'ensemble peut
 * révéler où et avec quel appareil la photo a été prise.
 *
 * Le parcours s'arrête au début des données compressées (`SOS`), qu'on recopie
 * telles quelles : l'image elle-même n'est jamais modifiée.
 */
export function retirerMetadonneesJpeg(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf
  const morceaux: Buffer[] = [buf.subarray(0, 2)]
  let p = 2
  while (p + 3 < buf.length) {
    if (buf[p] !== 0xff) break
    const marqueur = buf[p + 1]
    if (marqueur === 0xda) { morceaux.push(buf.subarray(p)); return Buffer.concat(morceaux) }
    if (marqueur === 0xd9) break
    const longueur = buf.readUInt16BE(p + 2)
    if (longueur < 2 || p + 2 + longueur > buf.length) break
    const estMetadonnee = (marqueur >= 0xe0 && marqueur <= 0xef) || marqueur === 0xfe
    if (!estMetadonnee) morceaux.push(buf.subarray(p, p + 2 + longueur))
    p += 2 + longueur
  }
  return Buffer.concat(morceaux)
}

/** L'image contient-elle encore un segment EXIF ? (contrôle de non-régression) */
export function contientExif(buf: Buffer): boolean {
  return buf.indexOf(Buffer.from('Exif\0\0', 'binary')) !== -1
}

// ─── Validation complète ─────────────────────────────────────────────────────

/**
 * Valide une image d'avatar reçue en data URL et rend ses octets NETTOYÉS.
 *
 * Les motifs de refus sont explicites : l'utilisateur doit comprendre pourquoi
 * sa photo est rejetée, sinon il réessaiera le même fichier.
 */
export function validerAvatar(dataUrl: unknown): AvatarValidation {
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
    return { ok: false, reason: 'Aucune image reçue.' }
  }
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/)
  if (!m) return { ok: false, reason: 'Format d’image non pris en charge.' }

  // Plafond AVANT décodage : le base64 pèse environ 4/3 des octets réels.
  if (m[2].length > Math.ceil(AVATAR_MAX_BYTES * 1.4)) {
    return { ok: false, reason: `Image trop volumineuse (maximum ${Math.round(AVATAR_MAX_BYTES / 1024 / 1024)} Mo).` }
  }

  let buf: Buffer
  try {
    buf = Buffer.from(m[2], 'base64')
  } catch {
    return { ok: false, reason: 'Image illisible.' }
  }
  if (buf.length === 0) return { ok: false, reason: 'Image vide.' }
  if (buf.length > AVATAR_MAX_BYTES) {
    return { ok: false, reason: `Image trop volumineuse (maximum ${Math.round(AVATAR_MAX_BYTES / 1024 / 1024)} Mo).` }
  }

  const mime = typeReel(buf)
  if (!mime) {
    // Couvre l'exécutable renommé, le HTML, le SVG et le fichier tronqué.
    return { ok: false, reason: 'Format non autorisé : une image JPEG, PNG ou WebP est attendue.' }
  }

  const dim = dimensionsImage(buf, mime)
  if (!dim) return { ok: false, reason: 'Image corrompue ou illisible.' }
  if (dim.width > AVATAR_MAX_DIMENSION || dim.height > AVATAR_MAX_DIMENSION) {
    return { ok: false, reason: `Image trop grande (maximum ${AVATAR_MAX_DIMENSION} × ${AVATAR_MAX_DIMENSION} pixels).` }
  }
  if (dim.width < AVATAR_MIN_DIMENSION || dim.height < AVATAR_MIN_DIMENSION) {
    return { ok: false, reason: `Image trop petite (minimum ${AVATAR_MIN_DIMENSION} × ${AVATAR_MIN_DIMENSION} pixels).` }
  }

  const propre = mime === 'image/jpeg' ? retirerMetadonneesJpeg(buf) : buf

  return {
    ok: true,
    mime,
    bytes: propre,
    width: dim.width,
    height: dim.height,
    hash: crypto.createHash('sha256').update(propre).digest('hex'),
  }
}

/**
 * Jeton d'invalidation de cache dérivé du CONTENU.
 *
 * Les URL d'avatar portent ce jeton : remplacer une photo change l'URL, donc ni
 * le navigateur, ni le service worker, ni un cache intermédiaire ne peuvent
 * servir l'ancienne. Un horodatage aurait suffi la plupart du temps, mais deux
 * écritures dans la même seconde auraient produit la même URL pour deux images
 * différentes.
 */
export function jetonCache(hash: string): string {
  return hash.slice(0, 16)
}
