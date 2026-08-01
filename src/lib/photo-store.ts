/**
 * Photo file storage — writes image files to GF_PHOTOS_DIR instead of SQLite.
 *
 * When GF_PHOTOS_DIR is set (Electron production), new photos are saved to disk
 * and only a relative path is stored in the database.
 * When unset (Next.js dev), the legacy base64 path is used as a fallback.
 */

import fs   from 'fs'
import path from 'path'
import crypto from 'crypto'

const PHOTOS_DIR = process.env.GF_PHOTOS_DIR ?? ''

/** Taille maximale d'une photo (data URL décodée) — anti-DoS de stockage. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024 // 8 Mo

/** Liste blanche MIME → extension. Aucune autre valeur n'est acceptée. */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Détecte le type d'image à partir des OCTETS RÉELS (magic bytes), pas de l'en-tête
 * MIME fourni par le client. Empêche l'usurpation de type de contenu : un fichier
 * HTML/SVG/polyglot annoncé « data:image/png » mais dont le contenu n'est pas une
 * image est rejeté. Renvoie l'extension déduite du contenu, ou `null`.
 */
export function sniffImageExt(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (
    buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'png'
  if (
    buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
  ) return 'gif'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

export function photosEnabled(): boolean {
  return PHOTOS_DIR.length > 0
}

/**
 * Valide une data URL d'image : format `data:image/<type>;base64,…`, MIME dans la
 * liste blanche, taille décodée ≤ MAX_PHOTO_BYTES, ET signature d'octets réelle
 * (magic bytes) correspondant au type annoncé. L'extension retournée est déduite
 * du CONTENU, jamais du client. Renvoie `null` si l'entrée est invalide, trop
 * volumineuse, ou si le contenu ne correspond pas à une image du bon type.
 */
export function parsePhotoDataUrl(
  base64DataUrl: unknown,
): { ext: string; buffer: Buffer } | null {
  if (typeof base64DataUrl !== 'string') return null
  const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  const [, mime, data] = match
  const claimedExt = MIME_TO_EXT[mime.toLowerCase()]
  if (!claimedExt) return null // MIME hors liste blanche → refus
  // Estimation rapide de la taille décodée AVANT allocation (4 chars b64 ≈ 3 octets).
  if ((data.length * 3) / 4 > MAX_PHOTO_BYTES) return null
  let buffer: Buffer
  try { buffer = Buffer.from(data, 'base64') } catch { return null }
  if (buffer.length === 0 || buffer.length > MAX_PHOTO_BYTES) return null
  // Validation de la SIGNATURE réelle : le contenu doit être une image dont le
  // type déduit des octets correspond au MIME annoncé (anti-usurpation).
  const sniffed = sniffImageExt(buffer)
  if (!sniffed || sniffed !== claimedExt) return null
  return { ext: sniffed, buffer }
}

/**
 * Save a base64 data URL to disk.
 * Returns the relative path (e.g. "jobs/abc/photo_xyz.webp") or null on failure.
 * SÉCURITÉ : MIME en liste blanche (extension jamais dérivée du client), taille
 * bornée (MAX_PHOTO_BYTES), et `subDir` neutralisé contre la traversée.
 */
export function savePhoto(
  base64DataUrl: string,
  subDir: string,   // e.g. "jobs/<jobId>" or "inspections/<inspectionId>"
): string | null {
  if (!photosEnabled()) return null

  try {
    const parsed = parsePhotoDataUrl(base64DataUrl)
    if (!parsed) return null
    const { ext, buffer } = parsed

    // Anti-traversée : n'autoriser que des segments alphanumériques simples.
    const safeSubDir = subDir
      .split('/')
      .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, ''))
      .filter(Boolean)
      .join('/')
    if (!safeSubDir) return null

    const filename = `photo_${crypto.randomBytes(8).toString('hex')}.${ext}`

    const dirPath = path.join(PHOTOS_DIR, safeSubDir)
    fs.mkdirSync(dirPath, { recursive: true })

    const filePath = path.join(dirPath, filename)
    fs.writeFileSync(filePath, buffer)

    return path.posix.join(safeSubDir, filename)
  } catch (err) {
    console.error('[photo-store] Failed to save photo:', err)
    return null
  }
}

/**
 * Delete a stored photo file. Silently ignores missing files.
 */
export function deletePhoto(relativePath: string): void {
  if (!photosEnabled() || !relativePath) return
  try {
    const fullPath = path.join(PHOTOS_DIR, relativePath)
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
  } catch {}
}

/**
 * Resolve a relative photo path to an absolute filesystem path.
 * Returns null if PHOTOS_DIR is not set or the path is missing.
 */
export function resolvePhoto(relativePath: string): string | null {
  if (!PHOTOS_DIR || !relativePath) return null
  const fullPath = path.join(PHOTOS_DIR, relativePath)
  return fs.existsSync(fullPath) ? fullPath : null
}
