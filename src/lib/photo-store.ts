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

export function photosEnabled(): boolean {
  return PHOTOS_DIR.length > 0
}

/**
 * Save a base64 data URL to disk.
 * Returns the relative path (e.g. "jobs/abc/photo_xyz.webp") or null on failure.
 */
export function savePhoto(
  base64DataUrl: string,
  subDir: string,   // e.g. "jobs/<jobId>" or "inspections/<inspectionId>"
): string | null {
  if (!photosEnabled()) return null

  try {
    // Strip the data URL prefix to get pure base64
    const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) return null
    const [, mime, data] = match

    const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
    const filename = `photo_${crypto.randomBytes(8).toString('hex')}.${ext}`

    const dirPath = path.join(PHOTOS_DIR, subDir)
    fs.mkdirSync(dirPath, { recursive: true })

    const filePath = path.join(dirPath, filename)
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'))

    return path.posix.join(subDir, filename)
  } catch (err) {
    console.error('[photo-store] Failed to save photo:', err)
    return null
  }
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
}

/**
 * Relit un fichier stocké et le rend sous forme de data URL.
 *
 * Utilisé par les pages PUBLIQUES (portail client, signature de devis) : elles
 * n'ont pas de session, donc `/api/photos/<path>` — authentifié à dessein — leur
 * est inaccessible. Sans cela, un garage dont le logo est stocké sur disque
 * (`logoPath`, cas normal depuis le passage au stockage fichier) n'affichait
 * aucun logo côté client.
 *
 * L'appelant a déjà prouvé son droit d'accès (jeton portail vérifié) ; ici on
 * ne garde que la protection anti-traversée et une borne de taille.
 */
export function readPhotoAsDataUrl(relativePath: string | null | undefined, maxBytes = 2_000_000): string | null {
  if (!photosEnabled() || !relativePath) return null
  try {
    const base = path.resolve(PHOTOS_DIR)
    const full = path.resolve(base, relativePath)
    const rel  = path.relative(base, full)
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null
    if (!fs.existsSync(full)) return null
    const stat = fs.statSync(full)
    if (!stat.isFile() || stat.size > maxBytes) return null
    const ext  = path.extname(full).slice(1).toLowerCase()
    const mime = MIME_BY_EXT[ext]
    if (!mime) return null
    return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`
  } catch {
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
