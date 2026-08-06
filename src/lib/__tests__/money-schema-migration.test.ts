/**
 * MIGRATION MONÉTAIRE SQLite — preuve sur données RÉELLES simulées.
 *
 * Rejoue les entrées 162+ de src/lib/migrations.ts (ADD → BACKFILL → DROP,
 * gardes onlyIfColumnExists/Missing incluses) avec la même sémantique que
 * /api/internal/migrate, sur :
 *   1. une base ANCIENNE (colonnes Float peuplées : positifs, négatifs, NULL,
 *      4 décimales, quantités fractionnaires) → conversion exacte + drop ;
 *   2. une RELANCE (idempotence : _gf_migrations empêche toute ré-exécution) ;
 *   3. une base NEUVE au schéma actuel → aucune entrée n'a d'effet (gardes).
 *
 * Utilise node:sqlite (même moteur que migrations-unique-index.test.ts).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, tableColumnsSql, type Migration } from '@/lib/migrations'

/** Applique les migrations avec la sémantique du runner (gardes + traçage). */
function runMigrations(db: DatabaseSync): { applied: string[]; skipped: string[] } {
  db.exec(`CREATE TABLE IF NOT EXISTS "_gf_migrations" ("id" TEXT PRIMARY KEY, "appliedAt" TEXT NOT NULL)`)
  const applied: string[] = []
  const skipped: string[] = []
  const columnExists = (t: string, c: string) => {
    const cols = db.prepare(tableColumnsSql(t)).all() as Array<{ name: string }>
    return cols.some((x) => x.name === c)
  }
  for (const m of MIGRATIONS as Migration[]) {
    const done = db.prepare(`SELECT id FROM "_gf_migrations" WHERE id = ?`).all(m.id)
    if (done.length > 0) { skipped.push(m.id); continue }
    // Les tables ciblées par une entrée sans garde peuvent manquer dans ce mini-
    // schéma de test : on ne rejoue que les entrées de la migration monétaire
    // (162+) + leurs gardes — le reste est marqué appliqué sans effet.
    const num = parseInt(m.id, 10)
    const isMoney = num >= 162
    let ran = false
    if (isMoney) {
      if (m.onlyIfColumnExists && !columnExists(m.onlyIfColumnExists.table, m.onlyIfColumnExists.column)) {
        // garde : non applicable → marquée appliquée
      } else if (m.onlyIfColumnMissing && columnExists(m.onlyIfColumnMissing.table, m.onlyIfColumnMissing.column)) {
        // garde : déjà en place → marquée appliquée
      } else if (m.sql) {
        db.exec(m.sql)
        ran = true
      }
    }
    db.prepare(`INSERT INTO "_gf_migrations" (id, appliedAt) VALUES (?, ?)`).run(m.id, new Date().toISOString())
    ;(ran ? applied : skipped).push(m.id)
  }
  return { applied, skipped }
}

/** Mini-schéma ANCIEN (colonnes Float d'avant migration) + données représentatives. */
function buildOldDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE "Garage" ("id" TEXT PRIMARY KEY, "hourlyRate" REAL NOT NULL DEFAULT 60);
    CREATE TABLE "Part" ("id" TEXT PRIMARY KEY, "quantity" INTEGER NOT NULL DEFAULT 0,
      "unitCost" REAL NOT NULL DEFAULT 0, "unitPrice" REAL NOT NULL DEFAULT 0);
    CREATE TABLE "JobPart" ("id" TEXT PRIMARY KEY, "quantity" INTEGER NOT NULL,
      "unitPrice" REAL NOT NULL, "unitCost" REAL NOT NULL);
    CREATE TABLE "QuoteLine" ("id" TEXT PRIMARY KEY, "quantity" REAL NOT NULL DEFAULT 1,
      "unitPrice" REAL NOT NULL DEFAULT 0, "unitCost" REAL NOT NULL DEFAULT 0);
    CREATE TABLE "InvoiceLine" ("id" TEXT PRIMARY KEY, "quantity" REAL NOT NULL DEFAULT 1,
      "unitPrice" REAL NOT NULL DEFAULT 0, "unitCost" REAL NOT NULL DEFAULT 0);
    CREATE TABLE "LaborOperation" ("id" TEXT PRIMARY KEY, "unitPrice" REAL NOT NULL DEFAULT 0);
    CREATE TABLE "LoanerReservation" ("id" TEXT PRIMARY KEY, "dailyRate" REAL, "depositAmount" REAL);
    CREATE TABLE "WorkOrder" ("id" TEXT PRIMARY KEY, "taxRate" REAL NOT NULL DEFAULT 20,
      "totalHT" REAL NOT NULL DEFAULT 0, "totalTTC" REAL NOT NULL DEFAULT 0);
    CREATE TABLE "PurchaseOrder" ("id" TEXT PRIMARY KEY, "totalHT" REAL NOT NULL DEFAULT 0);
  `)
  db.exec(`
    INSERT INTO "Garage" VALUES ('g1', 60), ('g2', 72.5);
    INSERT INTO "Part" VALUES ('p1', 5, 8.7654, 19.99), ('p2', 0, 0, 0);
    INSERT INTO "JobPart" VALUES ('jp1', 3, 12.3456, 8.7654);
    INSERT INTO "QuoteLine" VALUES ('ql1', 1.5, 9.9, 4.5), ('ql2', 0.25, 100, 0);
    INSERT INTO "InvoiceLine" VALUES
      ('il1', 2.375, 12.3456, 8.7654),
      ('il2', 1, -49.9, 0),          -- avoir (négatif)
      ('il3', 9999, 0.0001, 0);      -- extrême 4 décimales
    INSERT INTO "LaborOperation" VALUES ('lo1', 45.5);
    INSERT INTO "LoanerReservation" VALUES ('lr1', 35.9, 500), ('lr2', NULL, NULL);
    INSERT INTO "WorkOrder" VALUES ('wo1', 20, 165.48, 198.58);
    INSERT INTO "PurchaseOrder" VALUES ('po1', 160);
  `)
  return db
}

describe('migration monétaire SQLite (entrées 162+)', () => {
  let db: DatabaseSync
  let firstRun: { applied: string[]; skipped: string[] }
  beforeAll(() => {
    db = buildOldDb()
    firstRun = runMigrations(db)
  })

  it('supprime TOUTES les anciennes colonnes monétaires Float', () => {
    const cols = (t: string) => (db.prepare(tableColumnsSql(t)).all() as Array<{ name: string }>).map((c) => c.name)
    expect(cols('Garage')).not.toContain('hourlyRate')
    expect(cols('Part')).not.toContain('unitCost')
    expect(cols('Part')).not.toContain('unitPrice')
    expect(cols('JobPart')).not.toContain('unitPrice')
    expect(cols('QuoteLine')).not.toContain('quantity')
    expect(cols('InvoiceLine')).not.toContain('unitCost')
    expect(cols('LaborOperation')).not.toContain('unitPrice')
    expect(cols('LoanerReservation')).not.toContain('dailyRate')
    expect(cols('LoanerReservation')).not.toContain('depositAmount')
    expect(cols('WorkOrder')).not.toContain('totalHT')
    expect(cols('PurchaseOrder')).not.toContain('totalHT')
    // Part.quantity (stock, Int, non monétaire) est CONSERVÉ.
    expect(cols('Part')).toContain('quantity')
    expect(cols('JobPart')).toContain('quantity')
  })

  it('convertit exactement (round(x×10000) / round(x×100)), négatifs et NULL inclus', () => {
    const one = (sql: string) => db.prepare(sql).get() as Record<string, number | null>
    expect(one(`SELECT "hourlyRateTenThousandths" v FROM "Garage" WHERE id='g2'`).v).toBe(725000)
    expect(one(`SELECT "unitCostTenThousandths" v FROM "Part" WHERE id='p1'`).v).toBe(87654)
    expect(one(`SELECT "unitPriceTenThousandths" v FROM "Part" WHERE id='p1'`).v).toBe(199900)
    expect(one(`SELECT "unitPriceTenThousandths" v FROM "JobPart" WHERE id='jp1'`).v).toBe(123456)
    expect(one(`SELECT "quantityTenThousandths" v FROM "QuoteLine" WHERE id='ql1'`).v).toBe(15000)
    expect(one(`SELECT "quantityTenThousandths" v FROM "QuoteLine" WHERE id='ql2'`).v).toBe(2500)
    expect(one(`SELECT "quantityTenThousandths" v FROM "InvoiceLine" WHERE id='il1'`).v).toBe(23750)
    expect(one(`SELECT "unitPriceTenThousandths" v FROM "InvoiceLine" WHERE id='il2'`).v).toBe(-499000) // avoir
    expect(one(`SELECT "unitPriceTenThousandths" v FROM "InvoiceLine" WHERE id='il3'`).v).toBe(1)
    expect(one(`SELECT "dailyRateTenThousandths" v FROM "LoanerReservation" WHERE id='lr1'`).v).toBe(359000)
    expect(one(`SELECT "depositAmountCents" v FROM "LoanerReservation" WHERE id='lr1'`).v).toBe(50000)
    expect(one(`SELECT "dailyRateTenThousandths" v FROM "LoanerReservation" WHERE id='lr2'`).v).toBeNull()
    expect(one(`SELECT "totalHtCents" v FROM "WorkOrder" WHERE id='wo1'`).v).toBe(16548)
    expect(one(`SELECT "totalTtcCents" v FROM "WorkOrder" WHERE id='wo1'`).v).toBe(19858)
    expect(one(`SELECT "totalHtCents" v FROM "PurchaseOrder" WHERE id='po1'`).v).toBe(16000)
  })

  it('RELANCE : idempotente — plus rien ne s\'applique, rien ne casse', () => {
    const second = runMigrations(db)
    expect(second.applied).toHaveLength(0)
  })

  it('base NEUVE (schéma actuel) : toutes les entrées sont des no-op (gardes)', () => {
    const fresh = new DatabaseSync(':memory:')
    fresh.exec(`
      CREATE TABLE "Garage" ("id" TEXT PRIMARY KEY, "hourlyRateTenThousandths" INTEGER NOT NULL DEFAULT 600000);
      CREATE TABLE "Part" ("id" TEXT PRIMARY KEY, "quantity" INTEGER NOT NULL DEFAULT 0,
        "unitCostTenThousandths" INTEGER NOT NULL DEFAULT 0, "unitPriceTenThousandths" INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE "JobPart" ("id" TEXT PRIMARY KEY, "quantity" INTEGER NOT NULL,
        "unitPriceTenThousandths" INTEGER NOT NULL DEFAULT 0, "unitCostTenThousandths" INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE "QuoteLine" ("id" TEXT PRIMARY KEY, "quantityTenThousandths" INTEGER NOT NULL DEFAULT 10000,
        "unitPriceTenThousandths" INTEGER NOT NULL DEFAULT 0, "unitCostTenThousandths" INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE "InvoiceLine" ("id" TEXT PRIMARY KEY, "quantityTenThousandths" INTEGER NOT NULL DEFAULT 10000,
        "unitPriceTenThousandths" INTEGER NOT NULL DEFAULT 0, "unitCostTenThousandths" INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE "LaborOperation" ("id" TEXT PRIMARY KEY, "unitPriceTenThousandths" INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE "LoanerReservation" ("id" TEXT PRIMARY KEY, "dailyRateTenThousandths" INTEGER, "depositAmountCents" INTEGER);
      CREATE TABLE "WorkOrder" ("id" TEXT PRIMARY KEY, "taxRate" REAL NOT NULL DEFAULT 20,
        "totalHtCents" INTEGER NOT NULL DEFAULT 0, "totalTtcCents" INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE "PurchaseOrder" ("id" TEXT PRIMARY KEY, "totalHtCents" INTEGER NOT NULL DEFAULT 0);
    `)
    const run = runMigrations(fresh)
    expect(run.applied).toHaveLength(0) // gardes → tout no-op, zéro erreur
  })
})
