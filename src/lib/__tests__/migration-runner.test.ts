/**
 * Moteur de migration desktop — testé contre un VRAI SQLite (node:sqlite).
 *
 * Modèle FIDÈLE à la production : les installations reçoivent d'abord un
 * TEMPLATE (schéma complet via `prisma db push`), puis `MIGRATIONS` applique les
 * correctifs incrémentaux, suivis dans `_gf_migrations`. La liste n'est donc PAS
 * un constructeur de schéma « depuis le vide » : les `CREATE TABLE IF NOT EXISTS`
 * bâtissent les tables (avec toutes leurs colonnes), et les `ALTER … ADD COLUMN`
 * ne servent qu'aux bases anciennes où la colonne manquait encore.
 *
 * Deux scénarios exigés :
 *  - base NEUVE  : template complet (toutes les tables présentes) ;
 *  - base ANCIENNE : installation existante SANS les tables e-invoicing, mise à
 *    niveau → seules les migrations 120-126 doivent s'appliquer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import {
  runMigrations, ensureTrackingTables, appliedMigrationIds, pendingMigrations,
  applyPending, writeSchemaVersion, validateSchema, isConfirmedCorruption, existingTables,
  type RawDb,
} from '@/lib/migration-runner'
import { MIGRATIONS, SCHEMA_VERSION, type Migration } from '@/lib/migrations'

// Migrations « anciennes » = tout SAUF la persistance e-invoicing (ids 120-126).
const OLD_MIGRATIONS = MIGRATIONS.filter(m => !m.id.startsWith('12'))
const OLD_VERSION = OLD_MIGRATIONS.length
const EINVOICE_MIGRATIONS = MIGRATIONS.filter(m => m.id.startsWith('12'))

function makeDb(file: string): { db: RawDb; handle: DatabaseSync } {
  const handle = new DatabaseSync(file)
  const db: RawDb = {
    exec: async (sql, params) => {
      if (params && params.length) handle.prepare(sql).run(...(params as never[]))
      else handle.exec(sql)
    },
    query: async (sql, params) => {
      const stmt = handle.prepare(sql)
      return (params && params.length ? stmt.all(...(params as never[])) : stmt.all()) as never
    },
  }
  return { db, handle }
}

/**
 * Bâtit le schéma en appliquant la liste dans l'ordre, en IGNORANT les erreurs
 * attendues (ALTER avant CREATE de la table, ou ADD COLUMN en doublon) — c'est
 * exactement ce que fait la production par-dessus le template : les CREATE
 * bâtissent les tables avec toutes leurs colonnes, les ALTER complètent les
 * bases anciennes, et les instructions redondantes échouent sans dommage.
 */
async function buildSchema(db: RawDb, list: readonly Migration[]) {
  for (const m of list) {
    try { await db.exec(m.sql) } catch { /* erreur d'ordre/doublon attendue */ }
  }
}
/** Marque une série de migrations comme déjà appliquées (fixture). */
async function markApplied(db: RawDb, list: readonly Migration[]) {
  for (const m of list) {
    await db.exec('INSERT OR IGNORE INTO "_gf_migrations" ("id", "appliedAt") VALUES (?, ?)', [m.id, 'seed'])
  }
}
/** Fixture « installation existante » : schéma complet SANS e-invoicing, 001-119 suivies. */
async function seedOldInstall(db: RawDb) {
  await ensureTrackingTables(db)
  await buildSchema(db, OLD_MIGRATIONS)
  await markApplied(db, OLD_MIGRATIONS)
  await writeSchemaVersion(db, OLD_VERSION)
}

let dir: string
let file: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-mig-'))
  file = path.join(dir, 'test.db')
})
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } })

const noop = () => {}

describe('base NEUVE (template complet)', () => {
  it('le schéma canonique (CREATE) fournit toutes les tables critiques, e-invoicing incluse', async () => {
    const { db, handle } = makeDb(file)
    await ensureTrackingTables(db)
    await buildSchema(db, MIGRATIONS)
    const validation = await validateSchema(db)
    const tables = await existingTables(db)
    handle.close()
    expect(validation.ok).toBe(true)
    expect(validation.integrity).toBe('ok')
    expect(validation.missingTables).toEqual([])
    expect(tables.has('EInvoiceSubmission')).toBe(true)
    expect(tables.has('EInvoiceEvent')).toBe(true)
  })
})

describe('base ANCIENNE (installation existante mise à niveau)', () => {
  it("part d'un état SANS tables e-invoicing", async () => {
    const { db, handle } = makeDb(file)
    await seedOldInstall(db)
    const tables = await existingTables(db)
    const applied = await appliedMigrationIds(db)
    handle.close()
    expect(tables.has('EInvoiceSubmission')).toBe(false)
    expect(tables.has('EInvoiceEvent')).toBe(false)
    // 001-119 déjà suivies ; 120-126 restent en attente.
    expect(pendingMigrations(applied).map(m => m.id)).toEqual(EINVOICE_MIGRATIONS.map(m => m.id))
  })

  it("ajoute UNIQUEMENT les 7 migrations e-invoicing et valide le schéma", async () => {
    const { db: seed, handle: h1 } = makeDb(file)
    await seedOldInstall(seed)
    h1.close()

    const { db, handle } = makeDb(file)
    const summary = await runMigrations(db, noop)
    const tables = await existingTables(db)
    handle.close()

    expect(summary.ok).toBe(true)
    expect(summary.hadPending).toBe(true)
    expect(summary.appliedCount).toBe(EINVOICE_MIGRATIONS.length)
    expect(summary.appliedCount).toBe(7)
    expect(summary.results.map(r => r.id)).toEqual(EINVOICE_MIGRATIONS.map(m => m.id))
    expect(summary.results.every(r => r.status === 'ok')).toBe(true)
    expect(tables.has('EInvoiceSubmission')).toBe(true)
    expect(tables.has('EInvoiceEvent')).toBe(true)
    expect(summary.schemaVersion).toBe(SCHEMA_VERSION)
    expect(summary.validation.ok).toBe(true)
  })
})

describe('idempotence', () => {
  it('un second passage ne réapplique rien', async () => {
    const { db: seed, handle: h1 } = makeDb(file)
    await seedOldInstall(seed)
    h1.close()

    const { db, handle } = makeDb(file)
    await runMigrations(db, noop)          // applique 120-126
    const second = await runMigrations(db, noop)
    handle.close()

    expect(second.hadPending).toBe(false)
    expect(second.appliedCount).toBe(0)
    expect(second.results).toEqual([])
    expect(second.ok).toBe(true)
    expect(second.schemaVersion).toBe(SCHEMA_VERSION)
  })
})

describe('validation post-migration', () => {
  it('détecte une table critique manquante', async () => {
    const { db, handle } = makeDb(file)
    await ensureTrackingTables(db)
    await buildSchema(db, MIGRATIONS)
    await db.exec('DROP TABLE "EInvoiceEvent"')
    const validation = await validateSchema(db)
    handle.close()
    expect(validation.ok).toBe(false)
    expect(validation.missingTables).toContain('EInvoiceEvent')
    // Une table manquante n'est PAS une corruption confirmée.
    expect(isConfirmedCorruption(validation)).toBe(false)
  })

  it("intègre 'ok' sur une base saine", async () => {
    const { db, handle } = makeDb(file)
    await ensureTrackingTables(db)
    await buildSchema(db, MIGRATIONS)
    const validation = await validateSchema(db)
    handle.close()
    expect(validation.integrity).toBe('ok')
    expect(isConfirmedCorruption(validation)).toBe(false)
  })
})

describe('sémantique de corruption', () => {
  it('ne déclenche un rollback que sur corruption confirmée', () => {
    expect(isConfirmedCorruption({ ok: true, integrity: 'ok', missingTables: [] })).toBe(false)
    expect(isConfirmedCorruption({ ok: true, integrity: 'unknown', missingTables: [] })).toBe(false)
    expect(isConfirmedCorruption({ ok: false, integrity: '*** in database main ***', missingTables: [] })).toBe(true)
  })
})

describe('résilience : une migration défaillante est retentée, pas fatale', () => {
  it("marque l'échec sans bloquer les suivantes ni la marquer appliquée", async () => {
    const { db, handle } = makeDb(file)
    await ensureTrackingTables(db)
    const errors: string[] = []
    const bad: Migration[] = [
      { id: 'x_bad', sql: 'ALTER TABLE "DoesNotExist" ADD COLUMN "z" TEXT' },
      { id: 'x_good', sql: 'CREATE TABLE IF NOT EXISTS "Ok" ("id" TEXT PRIMARY KEY)' },
    ]
    const pending = pendingMigrations(await appliedMigrationIds(db), bad)
    const results = await applyPending(db, pending, (id) => errors.push(id))
    const tables = await existingTables(db)
    const stillPending = pendingMigrations(await appliedMigrationIds(db), bad)
    handle.close()

    expect(results.find(r => r.id === 'x_bad')?.status).toBe('error')
    expect(results.find(r => r.id === 'x_good')?.status).toBe('ok')
    expect(errors).toEqual(['x_bad'])
    expect(tables.has('Ok')).toBe(true)
    // La migration défaillante n'est pas suivie → retentée au prochain démarrage.
    expect(stillPending.map(m => m.id)).toEqual(['x_bad'])
  })
})

describe('version de schéma', () => {
  it('écrit et relit la version (singleton, upsert)', async () => {
    const { db, handle } = makeDb(file)
    await ensureTrackingTables(db)
    await writeSchemaVersion(db, 42)
    await writeSchemaVersion(db, 99)
    const rows = await db.query<{ version: number }>('SELECT version FROM "_gf_schema" WHERE id = 1')
    handle.close()
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].version)).toBe(99)
  })
})
