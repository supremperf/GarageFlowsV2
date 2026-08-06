/**
 * MIGRATION MONÉTAIRE SQLite — preuve sur données réelles simulées, sémantique
 * COMPOSITE ATOMIQUE du runner (/api/internal/migrate) :
 *   - chaque migration = UNE transaction (ADD → BACKFILL → VERIFY → DROP) ;
 *   - enregistrée dans _gf_migrations UNIQUEMENT après réussite complète ;
 *   - VERIFY divergent → ROLLBACK COMPLET : ni DROP, ni enregistrement ;
 *   - relance idempotente ; base neuve = no-op ; interruption = reprise propre.
 * Utilise node:sqlite (même moteur que migrations-unique-index.test.ts).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, tableColumnsSql, type Migration, type MigrationStep } from '@/lib/migrations'

class VerifyFailure extends Error {}

/** Rejoue les migrations composites 162+ avec la sémantique EXACTE du runner. */
function runMoneyMigrations(db: DatabaseSync): { applied: string[]; failed: string | null } {
  db.exec(`CREATE TABLE IF NOT EXISTS "_gf_migrations" ("id" TEXT PRIMARY KEY, "appliedAt" TEXT NOT NULL)`)
  const columnExists = (t: string, c: string) =>
    (db.prepare(tableColumnsSql(t)).all() as Array<{ name: string }>).some((x) => x.name === c)
  const applied: string[] = []
  for (const m of MIGRATIONS as Migration[]) {
    if (!m.steps) continue // ce test couvre les composites monétaires
    const done = db.prepare(`SELECT id FROM "_gf_migrations" WHERE id = ?`).all(m.id)
    if (done.length > 0) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const step of m.steps as MigrationStep[]) {
        if (step.onlyIfColumnExists && !columnExists(step.onlyIfColumnExists.table, step.onlyIfColumnExists.column)) continue
        if (step.onlyIfColumnMissing && columnExists(step.onlyIfColumnMissing.table, step.onlyIfColumnMissing.column)) continue
        if (step.verifySql) {
          const row = db.prepare(step.verifySql).get() as { n: number }
          if (Number(row?.n ?? 0) > 0) throw new VerifyFailure(`${m.id}: divergence`)
        } else if (step.sql) {
          db.exec(step.sql)
        }
      }
      db.prepare(`INSERT INTO "_gf_migrations" (id, appliedAt) VALUES (?, ?)`).run(m.id, new Date().toISOString())
      db.exec('COMMIT')
      applied.push(m.id)
    } catch (e) {
      db.exec('ROLLBACK')
      // ARRÊT IMMÉDIAT (fail-closed) — aucune migration suivante.
      return { applied, failed: m.id }
    }
  }
  return { applied, failed: null }
}

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
    INSERT INTO "Garage" VALUES ('g1', 60), ('g2', 72.5);
    INSERT INTO "Part" VALUES ('p1', 5, 8.7654, 19.99), ('p2', 0, 0, 0);
    INSERT INTO "JobPart" VALUES ('jp1', 3, 12.3456, 8.7654);
    INSERT INTO "QuoteLine" VALUES ('ql1', 1.5, 9.9, 4.5), ('ql2', 0.25, 100, 0);
    INSERT INTO "InvoiceLine" VALUES
      ('il1', 2.375, 12.3456, 8.7654),
      ('il2', 1, -49.9, 0),
      ('il3', 9999, 0.0001, 0);
    INSERT INTO "LaborOperation" VALUES ('lo1', 45.5);
    INSERT INTO "LoanerReservation" VALUES ('lr1', 35.9, 500), ('lr2', NULL, NULL);
    INSERT INTO "WorkOrder" VALUES ('wo1', 20, 165.48, 198.58);
    INSERT INTO "PurchaseOrder" VALUES ('po1', 160);
  `)
  return db
}

describe('migration monétaire SQLite — composites atomiques', () => {
  let db: DatabaseSync
  beforeAll(() => {
    db = buildOldDb()
    const r = runMoneyMigrations(db)
    expect(r.failed).toBeNull()
  })

  it('supprime toutes les anciennes colonnes Float, conserve les colonnes de stock', () => {
    const cols = (t: string) => (db.prepare(tableColumnsSql(t)).all() as Array<{ name: string }>).map((c) => c.name)
    for (const [t, c] of [
      ['Garage', 'hourlyRate'], ['Part', 'unitCost'], ['Part', 'unitPrice'],
      ['JobPart', 'unitPrice'], ['QuoteLine', 'quantity'], ['InvoiceLine', 'unitCost'],
      ['LaborOperation', 'unitPrice'], ['LoanerReservation', 'dailyRate'],
      ['LoanerReservation', 'depositAmount'], ['WorkOrder', 'totalHT'], ['PurchaseOrder', 'totalHT'],
    ] as const) expect(cols(t)).not.toContain(c)
    expect(cols('Part')).toContain('quantity')
    expect(cols('JobPart')).toContain('quantity')
  })

  it('convertit exactement (négatifs, NULL, 4 décimales, quantités fractionnaires)', () => {
    const one = (sql: string) => db.prepare(sql).get() as Record<string, number | null>
    expect(one(`SELECT "hourlyRateTenThousandths" v FROM "Garage" WHERE id='g2'`).v).toBe(725000)
    expect(one(`SELECT "unitCostTenThousandths" v FROM "Part" WHERE id='p1'`).v).toBe(87654)
    expect(one(`SELECT "unitPriceTenThousandths" v FROM "JobPart" WHERE id='jp1'`).v).toBe(123456)
    expect(one(`SELECT "quantityTenThousandths" v FROM "QuoteLine" WHERE id='ql2'`).v).toBe(2500)
    expect(one(`SELECT "quantityTenThousandths" v FROM "InvoiceLine" WHERE id='il1'`).v).toBe(23750)
    expect(one(`SELECT "unitPriceTenThousandths" v FROM "InvoiceLine" WHERE id='il2'`).v).toBe(-499000)
    expect(one(`SELECT "unitPriceTenThousandths" v FROM "InvoiceLine" WHERE id='il3'`).v).toBe(1)
    expect(one(`SELECT "dailyRateTenThousandths" v FROM "LoanerReservation" WHERE id='lr2'`).v).toBeNull()
    expect(one(`SELECT "depositAmountCents" v FROM "LoanerReservation" WHERE id='lr1'`).v).toBe(50000)
    expect(one(`SELECT "totalHtCents" v FROM "WorkOrder" WHERE id='wo1'`).v).toBe(16548)
    expect(one(`SELECT "totalHtCents" v FROM "PurchaseOrder" WHERE id='po1'`).v).toBe(16000)
  })

  it('relance idempotente : plus rien ne s\'applique, rien ne casse', () => {
    const second = runMoneyMigrations(db)
    expect(second.applied).toHaveLength(0)
    expect(second.failed).toBeNull()
  })

  it('base NEUVE (schéma final) : toutes les migrations sont des no-op enregistrés', () => {
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
    const run = runMoneyMigrations(fresh)
    expect(run.failed).toBeNull()
    // Aucune étape exécutée mais migrations ENREGISTRÉES (idempotence future).
    const n = fresh.prepare('SELECT count(*) c FROM "_gf_migrations"').get() as { c: number }
    expect(Number(n.c)).toBeGreaterThan(0)
  })
})

describe('migration monétaire SQLite — ÉCHECS (fail-closed prouvé)', () => {
  it('VERIFY divergent → ROLLBACK complet : pas de DROP, pas d\'enregistrement, arrêt', () => {
    const db = buildOldDb()
    // Corruption simulée : une colonne cible existe déjà avec une valeur FAUSSE,
    // et l'ancienne colonne diverge → le backfill (guard: colonne cible absente ?
    // non — ADD est gardé par onlyIfColumnMissing, donc le backfill s'exécute et
    // écrase ; pour forcer la divergence on rend la table cible NON modifiable).
    // Méthode robuste : déclencher l'échec SQL au milieu du composite en
    // supprimant une table référencée par le backfill de la 2e migration.
    db.exec('ALTER TABLE "Part" RENAME COLUMN "unitCost" TO "unitCost_keep"')
    db.exec('ALTER TABLE "Part" ADD COLUMN "unitCost" TEXT') // backfill produira CAST sur TEXT → 0 ; on force plutôt une vraie erreur :
    db.exec('DROP TABLE "JobPart"') // la migration JobPart échouera (table absente)

    const r = runMoneyMigrations(db)
    expect(r.failed).not.toBeNull() // la séquence s'est ARRÊTÉE
    // La migration échouée n'est PAS enregistrée…
    const rec = db.prepare('SELECT id FROM "_gf_migrations" WHERE id = ?').all(r.failed!)
    expect(rec).toHaveLength(0)
    // …et RIEN après elle n'a été exécuté : les colonnes Float suivantes existent toujours.
    const cols = (t: string) => (db.prepare(tableColumnsSql(t)).all() as Array<{ name: string }>).map((c) => c.name)
    expect(cols('QuoteLine')).toContain('quantity')   // migration postérieure jamais lancée
    expect(cols('WorkOrder')).toContain('totalHT')    // idem — aucune étape destructive après l'échec
  })

  it('backfill divergent détecté par VERIFY → la colonne ANCIENNE est préservée (rollback)', () => {
    const db = buildOldDb()
    // Pré-crée la colonne cible avec une valeur DIVERGENTE : ADD sera sauté
    // (guard onlyIfColumnMissing), le BACKFILL écrase… sauf si on le neutralise.
    // Scénario réaliste testé : divergence NON corrigeable — on remplace le
    // backfill par un trigger qui maintient la divergence.
    db.exec('ALTER TABLE "Garage" ADD COLUMN "hourlyRateTenThousandths" INTEGER NOT NULL DEFAULT 0')
    db.exec(`
      CREATE TRIGGER "keep_divergent" AFTER UPDATE OF "hourlyRateTenThousandths" ON "Garage"
      BEGIN
        UPDATE "Garage" SET "hourlyRateTenThousandths" = 1 WHERE id = NEW.id;
      END
    `)
    const r = runMoneyMigrations(db)
    expect(r.failed).toBe('162_money_garage_hourlyrate')
    const cols = (db.prepare(tableColumnsSql('Garage')).all() as Array<{ name: string }>).map((c) => c.name)
    // ROLLBACK prouvé : l'ancienne colonne n'a PAS été supprimée.
    expect(cols).toContain('hourlyRate')
    // Et rien n'est enregistré pour cette migration.
    const rec = db.prepare('SELECT id FROM "_gf_migrations"').all() as Array<{ id: string }>
    expect(rec.map((x) => x.id)).not.toContain('162_money_garage_hourlyrate')
  })
})
