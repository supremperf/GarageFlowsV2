import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Script CommonJS de restauration (scripts/restore.js) — logique pure testée.
const restore = require('../../../scripts/restore.js')

// En-tête SQLite valide : « SQLite format 3\0 » + rembourrage à >= 512 octets.
function writeValidSqlite(p: string) {
  const buf = Buffer.alloc(1024, 0)
  buf.write('SQLite format 3\0', 0, 'latin1')
  fs.writeFileSync(p, buf)
}

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-restore-')) })
afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* noop */ } })

describe('restore — parseSelection (flux interactif déterministe)', () => {
  it('« q » ou vide → quit', () => {
    expect(restore.parseSelection('q', 3)).toEqual({ kind: 'quit' })
    expect(restore.parseSelection('Q', 3)).toEqual({ kind: 'quit' })
    expect(restore.parseSelection('', 3)).toEqual({ kind: 'quit' })
    expect(restore.parseSelection('  ', 3)).toEqual({ kind: 'quit' })
  })
  it('numéro valide → index 0-based', () => {
    expect(restore.parseSelection('1', 3)).toEqual({ kind: 'index', index: 0 })
    expect(restore.parseSelection('3', 3)).toEqual({ kind: 'index', index: 2 })
  })
  it('hors bornes / non numérique → invalid', () => {
    expect(restore.parseSelection('0', 3)).toEqual({ kind: 'invalid' })
    expect(restore.parseSelection('4', 3)).toEqual({ kind: 'invalid' })
    expect(restore.parseSelection('abc', 3)).toEqual({ kind: 'invalid' })
    expect(restore.parseSelection('-1', 3)).toEqual({ kind: 'invalid' })
  })
})

describe('restore — isValidSqliteFile', () => {
  it('vrai pour un fichier SQLite valide', () => {
    const p = path.join(tmp, 'ok.db'); writeValidSqlite(p)
    expect(restore.isValidSqliteFile(p)).toBe(true)
  })
  it('faux pour un fichier texte / trop petit / absent', () => {
    const txt = path.join(tmp, 'bad.db'); fs.writeFileSync(txt, 'ceci n\'est pas une base')
    expect(restore.isValidSqliteFile(txt)).toBe(false)
    const small = path.join(tmp, 'small.db'); fs.writeFileSync(small, 'SQLite format 3\0')
    expect(restore.isValidSqliteFile(small)).toBe(false) // < 512 octets
    expect(restore.isValidSqliteFile(path.join(tmp, 'nope.db'))).toBe(false)
  })
})

describe('restore — doRestore (sûr, avec rollback)', () => {
  it('restaure une archive valide + crée une copie de sécurité', () => {
    const backup = path.join(tmp, 'backup.db'); writeValidSqlite(backup)
    const db = path.join(tmp, 'garageflow.db')
    const before = Buffer.alloc(1024, 0); before.write('SQLite format 3\0', 0, 'latin1'); before[600] = 0xAB
    fs.writeFileSync(db, before) // base courante (différente)

    const res = restore.doRestore(backup, { dbPath: db })
    expect(res.ok).toBe(true)
    expect(res.safetyPath).toBeTruthy()
    expect(fs.existsSync(res.safetyPath)).toBe(true)               // copie de sécurité présente
    expect(fs.readFileSync(db).equals(fs.readFileSync(backup))).toBe(true) // base = archive
    expect(fs.readFileSync(res.safetyPath)[600]).toBe(0xAB)        // sécurité = ancienne base
  })

  it('REFUSE une archive corrompue et NE clobbe PAS la base existante', () => {
    const badBackup = path.join(tmp, 'corrupt.db'); fs.writeFileSync(badBackup, 'not a database at all ...')
    const db = path.join(tmp, 'garageflow.db'); writeValidSqlite(db)
    const original = fs.readFileSync(db)

    const res = restore.doRestore(badBackup, { dbPath: db })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('BACKUP_INVALID')
    expect(fs.readFileSync(db).equals(original)).toBe(true) // base intacte (aucun écrasement)
  })

  it('archive absente → erreur structurée, base intacte', () => {
    const db = path.join(tmp, 'garageflow.db'); writeValidSqlite(db)
    const original = fs.readFileSync(db)
    const res = restore.doRestore(path.join(tmp, 'ghost.db'), { dbPath: db })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('BACKUP_NOT_FOUND')
    expect(fs.readFileSync(db).equals(original)).toBe(true)
  })

  it('première installation (pas de base courante) : restaure sans copie de sécurité', () => {
    const backup = path.join(tmp, 'backup.db'); writeValidSqlite(backup)
    const db = path.join(tmp, 'garageflow.db') // n'existe pas
    const res = restore.doRestore(backup, { dbPath: db })
    expect(res.ok).toBe(true)
    expect(res.safetyPath).toBeNull()
    expect(fs.existsSync(db)).toBe(true)
  })
})

describe('restore — listBackups', () => {
  it('liste hourly/daily/weekly, plus récent en premier', () => {
    for (const tier of ['hourly', 'daily', 'weekly']) fs.mkdirSync(path.join(tmp, tier), { recursive: true })
    writeValidSqlite(path.join(tmp, 'hourly', 'garageflow_20260101_08.db'))
    writeValidSqlite(path.join(tmp, 'hourly', 'garageflow_20260101_09.db'))
    writeValidSqlite(path.join(tmp, 'daily', 'garageflow_20260101.db'))
    const list = restore.listBackups(tmp)
    expect(list.length).toBe(3)
    // hourly triés en ordre décroissant (09 avant 08)
    const hourly = list.filter((b: any) => b.tier === 'hourly').map((b: any) => b.file)
    expect(hourly).toEqual(['garageflow_20260101_09.db', 'garageflow_20260101_08.db'])
  })
})
