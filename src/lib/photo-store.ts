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
