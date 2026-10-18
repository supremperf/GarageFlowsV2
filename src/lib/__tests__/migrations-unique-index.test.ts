/**
 * Tests du runner d'index UNIQUE desktop (contrôle de doublons) — item 2.
 *
 * Utilise le SQLite intégré de Node (node:sqlite, DatabaseSync) pour exécuter le
 * VRAI SQL généré par migrations.ts. Prouve :
 *  - sans doublon : l'index UNIQUE est créé ET la contrainte est appliquée ;
 *  - avec doublons : la détection les voit, l'index est DIFFÉRÉ (pas créé), et
 *    aucune donnée n'est supprimée (migration sûre) ;
 *  - NULL multiples : autorisés (NULL ≠ NULL) — pas de faux doublon ;
 *  - les 6 index UNIQUE du schéma sont bien présents dans MIGRATIONS.
 */
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import {
  MIGRATIONS,
  duplicateGroupsSql,
  createUniqueIndexSql,
  type UniqueIndexMigration,
} from '@/lib/migrations'

/** Simule la décision du runner (migrate/route.ts) pour un index UNIQUE. */
function applyUniqueIndex(db: DatabaseSync, u: UniqueIndexMigration): 'ok' | 'deferred' {
  const dupes = db.prepare(duplicateGroupsSql(u)).all()
  if (dupes.length > 0) return 'deferred'
  db.exec(createUniqueIndexSql(u))
  return 'ok'
}

const GARAGE_SLUG: UniqueIndexMigration = { name: 'Garage_slug_key', table: 'Garage', columns: ['slug'] }
const WO_JOB: UniqueIndexMigration = { name: 'WorkOrder_jobId_key', table: 'WorkOrder', columns: ['jobId'] }
const VEH: UniqueIndexMigration = {
  name: 'Vehicle_licensePlate_garageId_key', table: 'Vehicle', columns: ['licensePlate', 'garageId'],
}

describe('génération SQL (idempotente, identifiants échappés)', () => {
  it('createUniqueIndexSql — IF NOT EXISTS + colonnes citées', () => {
    expect(createUniqueIndexSql(VEH)).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Vehicle_licensePlate_garageId_key" ON "Vehicle"("licensePlate", "garageId")',
    )
  })
  it('duplicateGroupsSql — exclut les NULL', () => {
    expect(duplicateGroupsSql(WO_JOB)).toContain('"jobId" IS NOT NULL')
    expect(duplicateGroupsSql(WO_JOB)).toContain('HAVING COUNT(*) > 1')
  })
})

describe('sans doublon — index créé et contrainte appliquée', () => {
  it('crée l\'index et rejette ensuite un doublon', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE "Garage" ("id" TEXT PRIMARY KEY, "slug" TEXT NOT NULL)')
    db.prepare('INSERT INTO "Garage" (id, slug) VALUES (?, ?)').run('1', 'alpha')
    db.prepare('INSERT INTO "Garage" (id, slug) VALUES (?, ?)').run('2', 'beta')

    expect(applyUniqueIndex(db, GARAGE_SLUG)).toBe('ok')

    // La contrainte UNIQUE est désormais appliquée.
    expect(() =>
      db.prepare('INSERT INTO "Garage" (id, slug) VALUES (?, ?)').run('3', 'alpha'),
    ).toThrow(/UNIQUE/i)
    db.close()
  })

  it('index composite (licensePlate, garageId) : même plaque dans 2 garages autorisée', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE "Vehicle" ("id" TEXT PRIMARY KEY, "licensePlate" TEXT NOT NULL, "garageId" TEXT NOT NULL)')
    db.prepare('INSERT INTO "Vehicle" VALUES (?,?,?)').run('1', 'AB-123-CD', 'gA')
    db.prepare('INSERT INTO "Vehicle" VALUES (?,?,?)').run('2', 'AB-123-CD', 'gB') // autre garage : OK
    expect(applyUniqueIndex(db, VEH)).toBe('ok')
    // Doublon exact (même plaque + même garage) rejeté.
    expect(() => db.prepare('INSERT INTO "Vehicle" VALUES (?,?,?)').run('3', 'AB-123-CD', 'gA')).toThrow(/UNIQUE/i)
    db.close()
  })
})

describe('avec doublons — DIFFÉRÉ, aucune perte de données', () => {
  it('ne crée pas l\'index et conserve toutes les lignes', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE "Garage" ("id" TEXT PRIMARY KEY, "slug" TEXT NOT NULL)')
    db.prepare('INSERT INTO "Garage" (id, slug) VALUES (?, ?)').run('1', 'dup')
    db.prepare('INSERT INTO "Garage" (id, slug) VALUES (?, ?)').run('2', 'dup') // doublon
    db.prepare('INSERT INTO "Garage" (id, slug) VALUES (?, ?)').run('3', 'unique')

    expect(applyUniqueIndex(db, GARAGE_SLUG)).toBe('deferred')

    // Aucune donnée supprimée.
    const count = db.prepare('SELECT COUNT(*) AS c FROM "Garage"').get() as { c: number }
    expect(count.c).toBe(3)
    // Index non créé → une insertion de doublon supplémentaire reste possible
    // (on ne casse rien ; l'opérateur résout puis la migration réessaie).
    expect(() => db.prepare('INSERT INTO "Garage" (id, slug) VALUES (?, ?)').run('4', 'dup')).not.toThrow()
    db.close()
  })

  it('après résolution des doublons, l\'index se crée (réessai)', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE "Garage" ("id" TEXT PRIMARY KEY, "slug" TEXT NOT NULL)')
    db.prepare('INSERT INTO "Garage" (id, slug) VALUES (?, ?)').run('1', 'dup')
    db.prepare('INSERT INTO "Garage" (id, slug) VALUES (?, ?)').run('2', 'dup')
    expect(applyUniqueIndex(db, GARAGE_SLUG)).toBe('deferred')
    // L'opérateur nettoie le doublon.
    db.prepare('DELETE FROM "Garage" WHERE id = ?').run('2')
    expect(applyUniqueIndex(db, GARAGE_SLUG)).toBe('ok')
    db.close()
  })
})

describe('NULL multiples — pas de faux doublon (WorkOrder.jobId nullable)', () => {
  it('plusieurs jobId NULL sont autorisés et l\'index se crée', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE "WorkOrder" ("id" TEXT PRIMARY KEY, "jobId" TEXT)')
    db.prepare('INSERT INTO "WorkOrder" (id, jobId) VALUES (?, NULL)').run('1')
    db.prepare('INSERT INTO "WorkOrder" (id, jobId) VALUES (?, NULL)').run('2')
    db.prepare('INSERT INTO "WorkOrder" (id, jobId) VALUES (?, ?)').run('3', 'job-x')

    expect(applyUniqueIndex(db, WO_JOB)).toBe('ok') // NULL exclus → pas de doublon
    // Un vrai doublon non-NULL est rejeté ; un NULL de plus reste permis.
    expect(() => db.prepare('INSERT INTO "WorkOrder" (id, jobId) VALUES (?, ?)').run('4', 'job-x')).toThrow(/UNIQUE/i)
    expect(() => db.prepare('INSERT INTO "WorkOrder" (id, jobId) VALUES (?, NULL)').run('5')).not.toThrow()
    db.close()
  })
})

describe('couverture — les 6 index UNIQUE du schéma sont dans MIGRATIONS', () => {
  it('présents avec le nom d\'index Prisma attendu', () => {
    const names = MIGRATIONS.filter((m) => m.uniqueIndex).map((m) => m.uniqueIndex!.name)
    for (const expected of [
      'Garage_slug_key',
      'User_email_key',
      'Vehicle_licensePlate_garageId_key',
      'WorkOrder_jobId_key',
      'LicenseKey_licenseId_key',
      'LicenseKey_token_key',
    ]) {
      expect(names).toContain(expected)
    }
  })
})
