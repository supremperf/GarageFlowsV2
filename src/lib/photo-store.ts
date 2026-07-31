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

export function photosEnabled(): boolean {
  return PHOTOS_DIR.length > 0
}

/**
 * Valide une data URL d'image : format `data:image/<type>;base64,…`, MIME dans la
 * liste blanche, et taille décodée ≤ MAX_PHOTO_BYTES. Renvoie l'extension sûre et
 * le buffer, ou `null` si l'entrée est invalide/trop volumineuse.
 */
export function parsePhotoDataUrl(
  base64DataUrl: unknown,
): { ext: string; buffer: Buffer } | null {
  if (typeof base64DataUrl !== 'string') return null
  const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  const [, mime, data] = match
  const ext = MIME_TO_EXT[mime.toLowerCase()]
  if (!ext) return null // MIME hors liste blanche → refus (jamais d'extension dérivée du client)
  // Estimation rapide de la taille décodée AVANT allocation (4 chars b64 ≈ 3 octets).
  if ((data.length * 3) / 4 > MAX_PHOTO_BYTES) return null
  let buffer: Buffer
  try { buffer = Buffer.from(data, 'base64') } catch { return null }
  if (buffer.length === 0 || buffer.length > MAX_PHOTO_BYTES) return null
  return { ext, buffer }
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
