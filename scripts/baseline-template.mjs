#!/usr/bin/env node
/**
 * baseline-template.mjs — BASELINE du modèle SQLite (prisma/garageflow-template.db).
 *
 * Une base NEUVE créée depuis le modèle possède déjà le SCHÉMA FINAL : elle ne
 * doit rejouer AUCUNE migration historique. Ce script enregistre donc dans
 * `_gf_migrations` chaque migration connue (id + checksum de sa définition,
 * même empreinte que le runner /api/internal/migrate) — la baseline explicite.
 *
 * Il vérifie ensuite : PRAGMA integrity_check, PRAGMA foreign_key_check.
 * Sortie non nulle à la moindre anomalie.
 *
 * Prérequis : Node ≥ 22.5 (node:sqlite). Usage :
 *   node --experimental-strip-types scripts/baseline-template.mjs [chemin.db]
 */

import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.argv[2] ?? path.join(ROOT, 'prisma', 'garageflow-template.db')

if (!existsSync(dbPath)) {
  console.error(`❌ Modèle introuvable : ${dbPath}`)
  process.exit(1)
}

// Même empreinte que le runner (src/app/api/internal/migrate/route.ts).
function migrationChecksum(m) {
  return createHash('sha256')
    .update(JSON.stringify({ sql: m.sql ?? null, steps: m.steps ?? null, uniqueIndex: m.uniqueIndex ?? null, kind: m.kind ?? null }))
    .digest('hex')
}

// pathToFileURL est OBLIGATOIRE : sous Windows, `import()` reçoit sinon un
// chemin « C:\… » que le résolveur ESM interprète comme le schéma d'URL « c: »
// et rejette avec ERR_UNSUPPORTED_ESM_URL_SCHEME. Le script était donc
// inexécutable hors Linux, et avec lui le contrôle check:sqlite-template.
const { MIGRATIONS, createUniqueIndexSql } = await import(
  pathToFileURL(path.join(ROOT, 'src', 'lib', 'migrations.ts')).href
)

const db = new DatabaseSync(dbPath)
try {
  db.exec(`CREATE TABLE IF NOT EXISTS "_gf_migrations" (
    "id" TEXT PRIMARY KEY,
    "appliedAt" TEXT NOT NULL,
    "name" TEXT,
    "checksum" TEXT,
    "schemaVersion" INTEGER
  )`)
  // Mise à niveau du registre si le modèle vient d'une version antérieure.
  const cols = db.prepare(`PRAGMA table_info("_gf_migrations")`).all().map((c) => c.name)
  for (const [col, type] of [['name', 'TEXT'], ['checksum', 'TEXT'], ['schemaVersion', 'INTEGER']]) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE "_gf_migrations" ADD COLUMN "${col}" ${type}`)
  }

  const now = new Date().toISOString()
  const insert = db.prepare(
    `INSERT OR REPLACE INTO "_gf_migrations" (id, appliedAt, name, checksum, schemaVersion) VALUES (?, ?, ?, ?, ?)`,
  )

  // ─── Le modèle est CONVERGÉ, pas seulement estampillé ───────────────────────
  // Ce script se contentait d'INSCRIRE chaque migration dans le registre sans
  // jamais l'exécuter. Le modèle livré aux installations NEUVES accusait donc un
  // schéma « à jour » qu'il n'avait pas : PortalSnapshot (187) et
  // LicenseKey.cloudSyncedAt (186) manquaient à l'appel. Pire, le registre les
  // déclarant appliquées, le runner de démarrage les SAUTAIT — l'objet n'était
  // jamais créé, sur aucune base neuve, en silence.
  //
  // On applique donc réellement chaque migration avant de l'enregistrer. Toutes
  // sont idempotentes (garde de colonne, IF NOT EXISTS), donc rejouer la liste
  // entière sur un modèle déjà à jour ne fait rien — c'est ce qui rend
  // l'opération sûre et répétable.
  const columnExists = (table, column) => {
    try {
      return db.prepare(`PRAGMA table_info("${String(table).replace(/"/g, '""')}")`)
        .all().some((c) => c.name === column)
    } catch {
      return false // table absente → la colonne n'existe pas
    }
  }
  const stepApplies = (s) => {
    if (s.onlyIfColumnExists && !columnExists(s.onlyIfColumnExists.table, s.onlyIfColumnExists.column)) return false
    if (s.onlyIfColumnMissing && columnExists(s.onlyIfColumnMissing.table, s.onlyIfColumnMissing.column)) return false
    return true
  }

  let version = 0
  let executed = 0
  for (const m of MIGRATIONS) {
    version += 1
    try {
      if (m.kind === 'json-v2') {
        // Migration de DONNÉES : le modèle est vide, il n'y a rien à convertir.
      } else if (m.uniqueIndex) {
        // Modèle vierge : aucun doublon possible, l'index est créable directement.
        db.exec(createUniqueIndexSql(m.uniqueIndex)); executed += 1
      } else if (m.steps) {
        for (const step of m.steps) {
          if (!stepApplies(step)) continue
          if (step.verifySql) {
            const rows = db.prepare(step.verifySql).all()
            const n = Number(rows?.[0]?.n ?? 0)
            if (n !== 0) throw new Error(`vérification non satisfaite (n=${n})`)
            continue
          }
          if (step.sql) { db.exec(step.sql); executed += 1 }
        }
      } else if (m.sql && stepApplies(m)) {
        db.exec(m.sql); executed += 1
      }
    } catch (e) {
      console.error(`❌ Migration ${m.id} inapplicable au modèle : ${e.message}`)
      process.exit(1)
    }
    insert.run(m.id, now, m.id, migrationChecksum(m), version)
  }

  // Vérifications d'intégrité — résultats CONTRÔLÉS.
  const integ = db.prepare('PRAGMA integrity_check').all()
  if (!(integ.length === 1 && integ[0].integrity_check === 'ok')) {
    console.error('❌ integrity_check en échec :', JSON.stringify(integ.slice(0, 3)))
    process.exit(1)
  }
  const fk = db.prepare('PRAGMA foreign_key_check').all()
  if (fk.length > 0) {
    console.error(`❌ foreign_key_check : ${fk.length} violation(s)`)
    process.exit(1)
  }

  console.log(`✅ Baseline : ${version} migration(s) enregistrées dans ${path.basename(dbPath)} (schemaVersion=${version}), dont ${executed} instruction(s) réellement exécutée(s) pour converger le schéma. Intégrité + clés étrangères OK.`)
} finally {
  db.close()
}
