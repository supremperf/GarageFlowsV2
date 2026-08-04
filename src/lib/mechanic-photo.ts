/**
 * Validation stricte des photos envoyées par un mécanicien.
 *
 * Défense en profondeur côté serveur (jamais faire confiance au type MIME
 * annoncé par le client) :
 *  - formats autorisés : JPEG, PNG, WebP, HEIC/HEIF ;
 *  - le type réel est vérifié par les octets magiques (magic bytes), pas par
 *    l'en-tête `data:` déclaré ;
 *  - taille maximale (octets décodés) plafonnée ;
 *  - le nom de fichier final est généré côté serveur (voir photo-store.savePhoto) :
 *    aucun nom fourni par le client, donc aucun chemin relatif ni exécutable.
 */

export const MECHANIC_PHOTO_MAX_BYTES = 8 * 1024 * 1024 // 8 Mo décodés

export type PhotoValidation =
  | { ok: true; mime: string; bytes: number }
  | { ok: false; reason: string }

/** Sniffe le type réel d'une image d'après ses octets magiques. */
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null
  // JPEG : FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  // PNG : 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png'
  // WebP : "RIFF" .... "WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  // HEIC/HEIF : "ftyp" à l'offset 4, marque heic/heix/mif1/msf1
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12)
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heif'].includes(brand)) return 'image/heic'
  }
  return null
}

/**
 * Valide une data URL d'image. Renvoie le type réel sniffé (jamais celui
 * déclaré) et la taille décodée, ou un motif de refus neutre.
 */
export function validateMechanicPhoto(dataUrl: unknown): PhotoValidation {
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
    return { ok: false, reason: 'Photo manquante ou invalide.' }
  }
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!m) return { ok: false, reason: 'Format de photo non pris en charge.' }
  const [, , b64] = m

  // Plafond AVANT décodage complet (borne ~ base64 = 4/3 des octets).
  if (b64.length > Math.ceil(MECHANIC_PHOTO_MAX_BYTES * 1.4)) {
    return { ok: false, reason: 'Photo trop volumineuse (max 8 Mo).' }
  }

  let buf: Buffer
  try {
    buf = Buffer.from(b64, 'base64')
  } catch {
    return { ok: false, reason: 'Photo illisible.' }
  }
  if (buf.length === 0) return { ok: false, reason: 'Photo vide.' }
  if (buf.length > MECHANIC_PHOTO_MAX_BYTES) {
    return { ok: false, reason: 'Photo trop volumineuse (max 8 Mo).' }
  }

  const realMime = sniffImageMime(buf)
  if (!realMime) {
    return { ok: false, reason: 'Type de fichier non autorisé (image JPEG/PNG/WebP/HEIC attendue).' }
  }
  return { ok: true, mime: realMime, bytes: buf.length }
}
