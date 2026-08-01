/**
 * Sauvegarde / restauration du fichier base autour des migrations — testé avec
 * un VRAI fichier SQLite (node:sqlite) pour prouver que le rollback restaure
 * bien l'état pré-migration octet pour octet.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import {
  resolveSqliteFile, migrationBackupDir, backupBeforeMigration,
  restoreFromBackup, pruneMigrationBackups,
} from '@/lib/migration-backup'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-bak-')) })
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } })

describe('resolveSqliteFile', () => {
  it('résout un chemin absolu file:', () => {
    expect(resolveSqliteFile('file:/var/data/gf.db')).toBe('/var/data/gf.db')
  })
  it('résout un chemin relatif contre le cwd fourni', () => {
    expect(resolveSqliteFile('file:./prisma/dev.db', '/app')).toBe('/app/prisma/dev.db')
  })
  it('retire les paramètres de connexion', () => {
    expect(resolveSqliteFile('file:/d/gf.db?connection_limit=1')).toBe('/d/gf.db')
  })
  it('renvoie null pour PostgreSQL, mémoire, ou vide', () => {
    expect(resolveSqliteFile('postgresql://u:p@h/db')).toBeNull()
    expect(resolveSqliteFile('file::memory:')).toBeNull()
    expect(resolveSqliteFile(undefined)).toBeNull()
    expect(resolveSqliteFile('')).toBeNull()
  })
})

function seedDb(file: string, value: string) {
  const d = new DatabaseSync(file)
  d.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)')
  d.prepare('INSERT INTO t (v) VALUES (?)').run(value)
  d.close()
}
function readAll(file: string): string[] {
  const d = new DatabaseSync(file)
  const rows = d.prepare('SELECT v FROM t ORDER BY id').all() as { v: string }[]
  d.close()
  return rows.map(r => r.v)
}

describe('backupBeforeMigration', () => {
  it("renvoie null si le fichier base n'existe pas (première installation)", () => {
    const file = path.join(dir, 'absent.db')
    expect(backupBeforeMigration(file)).toBeNull()
    expect(fs.existsSync(migrationBackupDir(file))).toBe(false)
  })

  it('copie le fichier base dans le dossier de sauvegardes', () => {
    const file = path.join(dir, 'gf.db')
    seedDb(file, 'original')
    const backup = backupBeforeMigration(file, 'STAMP')
    expect(backup).not.toBeNull()
    expect(fs.existsSync(backup!)).toBe(true)
    expect(readAll(backup!)).toEqual(['original'])
    expect(path.dirname(backup!)).toBe(migrationBackupDir(file))
  })
})

describe('restoreFromBackup (rollback)', () => {
  it("restaure l'état pré-migration après modification", () => {
    const file = path.join(dir, 'gf.db')
    seedDb(file, 'v1')
    const backup = backupBeforeMigration(file, 'STAMP')!

    // Simule une migration qui modifie la base.
    const d = new DatabaseSync(file)
    d.prepare('INSERT INTO t (v) VALUES (?)').run('v2-corrompu')
    d.close()
    expect(readAll(file)).toEqual(['v1', 'v2-corrompu'])

    restoreFromBackup(file, backup)
    expect(readAll(file)).toEqual(['v1'])
  })

  it('échoue explicitement si la sauvegarde est absente (pas de masquage)', () => {
    const file = path.join(dir, 'gf.db')
    seedDb(file, 'v1')
    expect(() => restoreFromBackup(file, path.join(dir, 'nope.db'))).toThrow()
  })
})

describe('pruneMigrationBackups', () => {
  it('ne conserve que les N sauvegardes les plus récentes', () => {
    const file = path.join(dir, 'gf.db')
    seedDb(file, 'x')
    // Horodatages ISO croissants → tri lexicographique = chronologique.
    for (const s of ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']) {
      backupBeforeMigration(file, s)
    }
    pruneMigrationBackups(file, 2)
    const remaining = fs.readdirSync(migrationBackupDir(file)).filter(f => f.startsWith('pre-migration-')).sort()
    expect(remaining).toHaveLength(2)
    expect(remaining[0]).toContain('2026-03-01')
    expect(remaining[1]).toContain('2026-04-01')
  })
})
