/**
 * Sauvegarde PRÉ-MIGRATION (electron/pre-migration-backup.js) — preuve :
 *  - base valide → copie (db + -wal + -shm) VÉRIFIÉE (en-tête SQLite) ;
 *  - base absente → skip explicite (ok, jamais bloquant en première install) ;
 *  - fichier corrompu (mauvais en-tête / vide) → { ok:false } (la migration
 *    DOIT être bloquée par l'appelant) ;
 *  - rétention : garde les 5 plus récentes, ne supprime JAMAIS la nouvelle.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { createPreMigrationBackup, verifySqliteFile, KEEP_BACKUPS, PREFIX } = require('../../../electron/pre-migration-backup.js')

// En-tête RÉEL d'une base SQLite : « SQLite format 3 » terminé par un octet NUL.
const SQLITE_HEADER = Buffer.concat([Buffer.from('SQLite format 3' + String.fromCharCode(0), 'utf8'), Buffer.alloc(1024)])

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-premig-'))
})

describe('pre-migration-backup', () => {
  it('copie et VÉRIFIE la base + fichiers WAL, chemin horodaté explicite', () => {
    const db = path.join(dir, 'garageflow.db')
    fs.writeFileSync(db, SQLITE_HEADER)
    fs.writeFileSync(db + '-wal', Buffer.from('wal'))
    fs.writeFileSync(db + '-shm', Buffer.from('shm'))
    const r = createPreMigrationBackup(db, path.join(dir, 'bak'), { now: new Date('2026-08-06T10:30:00') })
    expect(r.ok).toBe(true)
    expect(r.skipped).toBe(false)
    expect(path.basename(r.path)).toBe(`${PREFIX}20260806-103000.db`)
    expect(r.files).toHaveLength(3) // db + -wal + -shm
    expect(fs.existsSync(r.path)).toBe(true)
    expect(fs.existsSync(r.path + '-wal')).toBe(true)
    expect(verifySqliteFile(r.path).ok).toBe(true)
  })

  it('copie le fichier -journal, celui qui existe RÉELLEMENT sur un poste', () => {
    // Le mode de journalisation d'un poste est `delete`, pas WAL : le fichier
    // annexe s'appelle `-journal`. Il ne figurait pas dans la liste copiée, si
    // bien qu'une base interrompue en plein commit était sauvegardée SANS
    // l'information qui permet de la ramener à un état cohérent. Restaurer une
    // telle copie rendait une base à moitié écrite.
    const db = path.join(dir, 'garageflow.db')
    fs.writeFileSync(db, SQLITE_HEADER)
    fs.writeFileSync(db + '-journal', Buffer.from('journal de restauration'))
    const r = createPreMigrationBackup(db, path.join(dir, 'bak'), { now: new Date('2026-08-15T09:00:00') })
    expect(r.ok).toBe(true)
    expect(fs.existsSync(r.path + '-journal'), 'sans le journal, la copie n’est pas restaurable').toBe(true)
    expect(fs.readFileSync(r.path + '-journal', 'utf8')).toBe('journal de restauration')
    expect(r.files).toHaveLength(2) // db + -journal ; -wal/-shm absents en mode delete
  })

  it('base absente (première installation) → skip explicite, pas de blocage', () => {
    const r = createPreMigrationBackup(path.join(dir, 'absent.db'), path.join(dir, 'bak'))
    expect(r).toMatchObject({ ok: true, skipped: true })
  })

  it('base au mauvais en-tête → { ok:false } (migration à BLOQUER)', () => {
    const db = path.join(dir, 'garageflow.db')
    fs.writeFileSync(db, Buffer.concat([Buffer.from('NOT A SQLITE DB!'), Buffer.alloc(1024)]))
    const r = createPreMigrationBackup(db, path.join(dir, 'bak'))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('invalide')
  })

  it('base quasi vide → { ok:false }', () => {
    const db = path.join(dir, 'garageflow.db')
    fs.writeFileSync(db, Buffer.from('SQLite format 3 ')) // < 512 octets
    const r = createPreMigrationBackup(db, path.join(dir, 'bak'))
    expect(r.ok).toBe(false)
  })

  it('rétention : conserve les 5 plus récentes, jamais la nouvelle', () => {
    const db = path.join(dir, 'garageflow.db')
    fs.writeFileSync(db, SQLITE_HEADER)
    const bak = path.join(dir, 'bak')
    for (let i = 0; i < 8; i++) {
      const r = createPreMigrationBackup(db, bak, { now: new Date(2026, 0, 1, 8, 0, i) })
      expect(r.ok).toBe(true)
    }
    const kept = fs.readdirSync(bak).filter((f) => f.startsWith(PREFIX) && f.endsWith('.db'))
    expect(kept).toHaveLength(KEEP_BACKUPS)
    // La plus récente est bien conservée.
    expect(kept.sort().at(-1)).toBe(`${PREFIX}20260101-080007.db`)
  })
})
