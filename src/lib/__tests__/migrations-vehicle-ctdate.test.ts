import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, type Migration } from '../migrations'

/**
 * Régression — `Vehicle.ctDate` absente des bases DÉJÀ en service.
 *
 * `054_ensure_vehicle_table` crée Vehicle via `CREATE TABLE IF NOT EXISTS` en
 * incluant "ctDate". Sur une base où Vehicle existait déjà sans cette colonne,
 * l'instruction est un NO-OP SILENCIEUX : la colonne n'arrive jamais, et Prisma
 * échoue ensuite à la lecture.
 *
 * Constaté en production chez l'opérateur :
 *   GET /api/vehicles → 500 INTERNAL_ERROR
 *   « The column `main.Vehicle.ctDate` does not exist in the current database »
 * → recherche par plaque, fiche véhicule et alertes de contrôle technique HS.
 *
 * Ces tests rejouent la séquence sur une base portant l'ANCIENNE forme de la
 * table et exigent que la colonne finisse par exister.
 */

/** Forme héritée de Vehicle : celle des bases antérieures, SANS ctDate. */
const VEHICLE_HERITE = `CREATE TABLE "Vehicle" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "licensePlate" TEXT NOT NULL,
  "vin" TEXT,
  "make" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "year" INTEGER,
  "mileage" INTEGER,
  "color" TEXT,
  "notes" TEXT,
  "clientId" TEXT NOT NULL,
  "garageId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
)`

function colonnes(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(r => r.name)
}

/** Applique une migration en respectant ses gardes, comme le fait le runner. */
function appliquer(db: DatabaseSync, m: Migration): void {
  const existe = (t: string, c: string) => colonnes(db, t).includes(c)
  if (m.onlyIfColumnExists && !existe(m.onlyIfColumnExists.table, m.onlyIfColumnExists.column)) return
  if (m.onlyIfColumnMissing && existe(m.onlyIfColumnMissing.table, m.onlyIfColumnMissing.column)) return
  if (m.sql) db.exec(m.sql)
}

describe('migrations — Vehicle.ctDate sur une base héritée', () => {
  const migrationCt = MIGRATIONS.find(m => m.id === '185_vehicle_ct_date')

  it('la migration de rattrapage existe et porte une garde d’idempotence', () => {
    expect(migrationCt).toBeDefined()
    expect(migrationCt!.onlyIfColumnMissing).toEqual({ table: 'Vehicle', column: 'ctDate' })
    expect(migrationCt!.sql).toContain('ADD COLUMN "ctDate"')
  })

  it('054_ensure_vehicle_table est bien un NO-OP sur une table préexistante (cause du bug)', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(VEHICLE_HERITE)
    const ensure = MIGRATIONS.find(m => m.id === '054_ensure_vehicle_table')!
    db.exec(ensure.sql!)
    // C'est précisément là que le bug se produisait : aucune erreur, aucune colonne.
    expect(colonnes(db, 'Vehicle')).not.toContain('ctDate')
    db.close()
  })

  it('après la séquence complète, ctDate EXISTE sur une base héritée', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(VEHICLE_HERITE)
    appliquer(db, MIGRATIONS.find(m => m.id === '054_ensure_vehicle_table')!)
    appliquer(db, migrationCt!)
    expect(colonnes(db, 'Vehicle')).toContain('ctDate')
    db.close()
  })

  it('rejouer le rattrapage est sans effet (idempotent, pas de duplicate column)', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(VEHICLE_HERITE)
    appliquer(db, migrationCt!)
    expect(colonnes(db, 'Vehicle')).toContain('ctDate')
    expect(() => appliquer(db, migrationCt!)).not.toThrow()
    expect(colonnes(db, 'Vehicle').filter(c => c === 'ctDate')).toHaveLength(1)
    db.close()
  })

  it('sur une base NEUVE (table créée par la migration), aucun doublon non plus', () => {
    const db = new DatabaseSync(':memory:')
    appliquer(db, MIGRATIONS.find(m => m.id === '054_ensure_vehicle_table')!)
    expect(colonnes(db, 'Vehicle')).toContain('ctDate')
    appliquer(db, migrationCt!) // garde → no-op
    expect(colonnes(db, 'Vehicle').filter(c => c === 'ctDate')).toHaveLength(1)
    db.close()
  })
})
