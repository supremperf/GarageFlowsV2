/**
 * Sauvegarde / restauration du FICHIER base SQLite autour des migrations.
 *
 * Complète `migration-runner.ts` (cœur pur) avec l'accès disque : avant
 * d'appliquer des migrations en attente, on copie le fichier base (et ses
 * journaux WAL/SHM) dans un dossier de sauvegardes horodatées. Si la validation
 * post-migration détecte une corruption, on restaure cette copie.
 *
 * Ne s'applique qu'aux bases SQLite locales (`file:`). En PostgreSQL (serveur),
 * les migrations passent par `prisma migrate deploy` et ces helpers renvoient
 * `null` (aucune opération fichier).
 */

import fs from 'fs'
import path from 'path'

/**
 * Résout le chemin absolu du fichier SQLite depuis une URL `DATABASE_URL`.
 * Renvoie `null` si l'URL ne désigne pas un fichier (ex. PostgreSQL) ou pointe
 * vers `:memory:`.
 */
export function resolveSqliteFile(databaseUrl: string | undefined, cwd: string = process.cwd()): string | null {
  if (!databaseUrl) return null
  const m = /^file:(.*)$/i.exec(databaseUrl.trim())
  if (!m) return null
  let p = m[1].trim()
  // Retire un éventuel jeu de paramètres de connexion (?connection_limit=...).
  const q = p.indexOf('?')
  if (q >= 0) p = p.slice(0, q)
  if (!p || p === ':memory:') return null
  return path.isAbsolute(p) ? p : path.resolve(cwd, p)
}

/** Dossier des sauvegardes pré-migration (à côté du fichier base). */
export function migrationBackupDir(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'migration-backups')
}

/**
 * Copie le fichier base (+ WAL/SHM s'ils existent) dans le dossier de
 * sauvegardes. Renvoie le chemin de la copie principale, ou `null` si le
 * fichier base n'existe pas encore (première installation : rien à sauvegarder).
 * `stamp` est injecté pour des tests déterministes.
 */
export function backupBeforeMigration(
  dbPath: string,
  stamp: string = new Date().toISOString().replace(/[:.]/g, '-'),
): string | null {
  if (!fs.existsSync(dbPath)) return null
  const dir = migrationBackupDir(dbPath)
  fs.mkdirSync(dir, { recursive: true })
  const base = path.basename(dbPath)
  const dest = path.join(dir, `pre-migration-${stamp}-${base}`)
  fs.copyFileSync(dbPath, dest)
  // Copie les journaux WAL/SHM si présents pour une restauration cohérente.
  for (const suffix of ['-wal', '-shm']) {
    const j = dbPath + suffix
    if (fs.existsSync(j)) {
      try { fs.copyFileSync(j, dest + suffix) } catch { /* best-effort */ }
    }
  }
  return dest
}

/**
 * Restaure la base depuis une sauvegarde pré-migration (rollback). Remet aussi
 * les journaux WAL/SHM sauvegardés et supprime tout journal résiduel de la base
 * courante pour éviter un état incohérent.
 */
export function restoreFromBackup(dbPath: string, backupPath: string): void {
  if (!fs.existsSync(backupPath)) throw new Error('Sauvegarde pré-migration introuvable')
  fs.copyFileSync(backupPath, dbPath)
  for (const suffix of ['-wal', '-shm']) {
    const src = backupPath + suffix
    const dst = dbPath + suffix
    if (fs.existsSync(src)) fs.copyFileSync(src, dst)
    else if (fs.existsSync(dst)) { try { fs.rmSync(dst) } catch { /* ignore */ } }
  }
}

/**
 * Ne conserve que les `keep` sauvegardes pré-migration les plus récentes
 * (tri lexicographique sur l'horodatage ISO, croissant dans le nom).
 */
export function pruneMigrationBackups(dbPath: string, keep = 5): void {
  const dir = migrationBackupDir(dbPath)
  if (!fs.existsSync(dir)) return
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('pre-migration-') && !f.endsWith('-wal') && !f.endsWith('-shm'))
    .sort()
  const excess = files.slice(0, Math.max(0, files.length - keep))
  for (const f of excess) {
    for (const suffix of ['', '-wal', '-shm']) {
      const p = path.join(dir, f + suffix)
      if (fs.existsSync(p)) { try { fs.rmSync(p) } catch { /* ignore */ } }
    }
  }
}
