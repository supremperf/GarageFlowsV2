// ═══════════════════════════════════════════════════════════════════════════════
//  GarageFlows — Sauvegarde PRÉ-MIGRATION de la base SQLite (pur, testable)
//
//  Appelée AVANT le démarrage du serveur interne (la base n'est alors ouverte
//  par AUCUN processus de l'application) : la copie du fichier principal ET de
//  ses annexes WAL (-wal, -shm) est donc COHÉRENTE. La sauvegarde est ensuite
//  VÉRIFIÉE (existence, taille, en-tête SQLite) — une sauvegarde invalide
//  INTERDIT la migration (l'appelant doit s'arrêter, fail-closed).
//
//  Rétention : les N dernières sauvegardes pré-migration sont conservées ; la
//  rotation ne supprime JAMAIS la copie qui vient d'être créée.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict'

const fs = require('fs')
const path = require('path')

const SQLITE_MAGIC = 'SQLite format 3\u0000'
const KEEP_BACKUPS = 5
const PREFIX = 'garageflows-pre-migration-'
const OWNED_NAME = /^garageflows-pre-migration-(\d{8}-\d{6})(?:-(\d{6}))?\.db$/
const ANNEXES = ['-journal', '-wal', '-shm']

function exists(file, fsImpl) {
  try { fsImpl.lstatSync(file); return true }
  catch (err) { if (err.code === 'ENOENT') return false; throw err }
}

function stamp(now) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

/** Vérifie qu'un fichier est une base SQLite plausible (en-tête + taille). */
function verifySqliteFile(filePath, fsImpl = fs) {
  let fd
  try {
    fd = fsImpl.openSync(filePath, 'r')
    const st = fsImpl.fstatSync(fd)
    if (!st.isFile() || st.size < 512) return { ok: false, error: `fichier vide ou trop petit (${st.size} octets)` }
    const buf = Buffer.alloc(16)
    fsImpl.readSync(fd, buf, 0, 16, 0)
    if (buf.toString('utf8') !== SQLITE_MAGIC) return { ok: false, error: 'en-tête SQLite invalide' }
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: `vérification impossible : ${err.message}` }
  } finally {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd) } catch (closeErr) { /* fermeture best-effort : le verdict est déjà établi */ }
    }
  }
}

/**
 * Crée et VÉRIFIE la sauvegarde pré-migration.
 * Renvoie { ok, skipped, path, files, error } — ne lance jamais, ne masque jamais.
 *  - base absente (première installation) → { ok:true, skipped:true } ;
 *  - toute erreur de copie/vérification → { ok:false, error } (l'appelant DOIT
 *    bloquer la migration).
 */
function createPreMigrationBackup(dbPath, backupDir, opts = {}) {
  const fsImpl = opts.fs ?? fs
  const now = opts.now ?? new Date()
  try {
    if (!exists(dbPath, fsImpl)) {
      return { ok: true, skipped: true, path: null, files: [], error: null }
    }
    fsImpl.mkdirSync(backupDir, { recursive: true })
    if (!Number.isFinite(now.getTime())) throw new Error('horodatage de sauvegarde invalide')
    const timestamp = stamp(now)
    // Count existing DBs AND orphan annexes: a removed primary must not cause
    // reuse of its old journal or of a lower chronological sequence number.
    const names = fsImpl.readdirSync(backupDir)
    let sequence = -1
    for (const name of names) {
      const match = OWNED_NAME.exec(name.replace(/-(journal|wal|shm)$/, ''))
      if (match && match[1] === timestamp) sequence = Math.max(sequence, Number(match[2] || 0))
    }
    let dest = null
    const copied = []
    // The directory inventory is NOT a lock. COPYFILE_EXCL is the atomic
    // no-overwrite guarantee; a racing writer advances the bounded sequence.
    for (let attempt = 0; attempt < 1000; attempt++) {
      sequence++
      if (sequence > 999999) throw new Error('espace de noms de sauvegarde épuisé')
      const base = `${PREFIX}${timestamp}${sequence ? '-' + String(sequence).padStart(6, '0') : ''}.db`
      const candidate = path.join(backupDir, base)
      if (ANNEXES.some(suffix => exists(candidate + suffix, fsImpl))) continue
      try {
        fsImpl.copyFileSync(dbPath, candidate, fs.constants.COPYFILE_EXCL)
        dest = candidate
        copied.push(dest)
        break
      } catch (err) { if (err.code !== 'EEXIST') throw err }
    }
    if (!dest) throw new Error('collision persistante de sauvegarde (1000 essais)')

    // Fichier principal + fichiers annexes — copiés ENSEMBLE (cohérents car la
    // base n'est ouverte par aucun processus à ce stade).
    //
    // `-journal` est le fichier qui existe RÉELLEMENT sur un poste : le mode de
    // journalisation mesuré est `delete` (journal de restauration), pas WAL.
    // Il n'était pas copié, alors que c'est lui qui porte l'état antérieur des
    // pages quand l'application a été interrompue en plein commit — sans lui,
    // restaurer la copie principale seule laisse une base à moitié écrite.
    // `-wal` et `-shm` sont conservés dans la liste : ils ne coûtent rien tant
    // qu'ils n'existent pas, et couvriraient un passage ultérieur en mode WAL.
    for (const suffix of ANNEXES) {
      const src = dbPath + suffix
      if (fsImpl.existsSync(src)) {
        const destSide = dest + suffix
        fsImpl.copyFileSync(src, destSide, fs.constants.COPYFILE_EXCL)
        copied.push(destSide)
      }
    }

    // Vérification OBLIGATOIRE de la copie principale.
    const check = verifySqliteFile(dest, fsImpl)
    if (!check.ok) {
      return { ok: false, skipped: false, path: dest, files: copied, error: `sauvegarde invalide : ${check.error}` }
    }

    // Rétention : garde les KEEP_BACKUPS plus récentes (jamais celle-ci).
    try {
      const all = fsImpl
        .readdirSync(backupDir)
        .filter((f) => OWNED_NAME.test(f))
        .sort((a, b) => {
          const ma = OWNED_NAME.exec(a), mb = OWNED_NAME.exec(b)
          return ma[1].localeCompare(mb[1]) || Number(ma[2] || 0) - Number(mb[2] || 0)
        }) // timestamp + monotonic collision sequence, not punctuation order
      const excess = all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))
      for (const f of excess) {
        if (path.join(backupDir, f) === dest) continue // jamais la nouvelle
        for (const suffix of ['', ...ANNEXES]) {
          const p = path.join(backupDir, f + suffix)
          if (fsImpl.existsSync(p)) fsImpl.unlinkSync(p)
        }
      }
    } catch (rotErr) {
      // La rotation est SECONDAIRE : son échec n'invalide pas la sauvegarde,
      // mais il est SIGNALÉ (jamais silencieux).
      return { ok: true, skipped: false, path: dest, files: copied, error: null, warning: `rotation incomplète : ${rotErr.message}` }
    }

    return { ok: true, skipped: false, path: dest, files: copied, error: null }
  } catch (err) {
    return { ok: false, skipped: false, path: null, files: [], error: err.message }
  }
}

module.exports = { createPreMigrationBackup, verifySqliteFile, KEEP_BACKUPS, PREFIX }
