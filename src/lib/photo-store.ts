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
 * Types d'image ACCEPTÉS et extension correspondante — liste blanche fermée.
 *
 * L'extension ne doit JAMAIS être dérivée de la chaîne fournie par le client :
 * `mime.split('/')[1]` acceptait n'importe quoi, y compris des séparateurs de
 * chemin. Sur Windows, un type « x/..\..\..\evil.bat » produisait l'extension
 * « ..\..\..\evil.bat », et `path.join` la normalisait : le fichier sortait du
 * dossier des photos, avec un contenu entièrement choisi par l'appelant
 * (écriture de fichier ARBITRAIRE — GF31-AUD-004). Un simple « x/exe » suffisait
 * par ailleurs à déposer un exécutable dans le dossier des photos.
 */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Sous-dossier de destination : uniquement des segments simples, alphanumériques
 * (identifiants Prisma cuid/uuid) — jamais « .. », jamais de séparateur exotique.
 * Les appelants le construisent depuis un paramètre d'URL (`jobs/${params.id}`),
 * donc il est lui aussi d'origine cliente.
 */
function safeSubDir(subDir: string): string | null {
  const parts = subDir.split('/').filter((p) => p.length > 0)
  if (parts.length === 0 || parts.length > 3) return null
  for (const p of parts) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(p)) return null
  }
  return parts.join('/')
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

    // Liste blanche fermée : un type non reconnu est REFUSÉ, jamais rattrapé par
    // une extension par défaut (qui laisserait passer un contenu non-image).
    const ext = EXT_BY_MIME[mime.trim().toLowerCase()]
    if (!ext) return null

    const safeDir = safeSubDir(subDir)
    if (!safeDir) return null

    const filename = `photo_${crypto.randomBytes(8).toString('hex')}.${ext}`

    const dirPath = path.join(PHOTOS_DIR, safeDir)
    fs.mkdirSync(dirPath, { recursive: true })

    const filePath = path.join(dirPath, filename)
    // Défense en profondeur : quoi qu'il arrive en amont, le fichier écrit doit
    // rester SOUS le dossier des photos.
    const base = path.resolve(PHOTOS_DIR)
    const rel = path.relative(base, path.resolve(filePath))
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null

    fs.writeFileSync(filePath, Buffer.from(data, 'base64'))

    return path.posix.join(safeDir, filename)
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
    // Pas de existsSync préalable (course check-then-use) : statSync lève si
    // le fichier est absent, et le catch ci-dessous rend null de toute façon.
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
 * Supprime un fichier stocké. Ignore silencieusement un fichier déjà absent.
 *
 * La garde anti-traversée manquait ici alors qu'elle protège `savePhoto` et
 * `readPhotoAsDataUrl` : `path.join(PHOTOS_DIR, relativePath)` normalise
 * « ../../ », si bien qu'un chemin remontant aurait supprimé un fichier
 * ARBITRAIRE hors du dossier des photos. Les chemins passés aujourd'hui
 * proviennent tous de la base et ont été générés par `savePhoto`, donc le défaut
 * n'était pas atteignable — mais c'est exactement le genre d'asymétrie qui
 * devient une faille le jour où un appelant transmet un chemin d'une autre
 * origine. La règle vaut donc pour les trois fonctions, sans exception.
 */
export function deletePhoto(relativePath: string): void {
  if (!photosEnabled() || !relativePath) return
  try {
    const base = path.resolve(PHOTOS_DIR)
    const fullPath = path.resolve(base, relativePath)
    const rel = path.relative(base, fullPath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) return
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
  } catch {}
}
