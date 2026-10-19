#!/usr/bin/env node
/**
 * check-sqlite-template.mjs — garde-fou du MODÈLE SQLite (CI).
 *
 * Ouvre réellement prisma/garageflow-template.db et vérifie :
 *   1. PRAGMA integrity_check = ok ;
 *   2. PRAGMA foreign_key_check = 0 violation ;
 *   3. registre `_gf_migrations` présent (avec colonnes name/checksum/schemaVersion) ;
 *   4. BASELINE complète : CHAQUE migration connue est enregistrée (zéro
 *      migration en attente au premier lancement d'une base neuve) ;
 *   5. checksums du registre = checksums des définitions actuelles (aucune
 *      divergence silencieuse) ;
 *   6. schéma FINAL : aucune ancienne colonne monétaire Float présente.
 *
 * Échec (exit 1) à la moindre anomalie. Prérequis : Node ≥ 22.5 (node:sqlite).
 */

import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = path.join(ROOT, 'prisma', 'garageflow-template.db')

if (!existsSync(dbPath)) {
  console.error(`❌ Modèle introuvable : ${dbPath}`)
  process.exit(1)
}

function migrationChecksum(m) {
  return createHash('sha256')
    .update(JSON.stringify({ sql: m.sql ?? null, steps: m.steps ?? null, uniqueIndex: m.uniqueIndex ?? null, kind: m.kind ?? null }))
    .digest('hex')
}

// `import()` attend un SPÉCIFICATEUR, pas un chemin OS. Un chemin POSIX absolu
// (« /… ») se résout par chance comme une URL, mais sous Windows « C:\… » est lu
// comme un protocole « c: » → ERR_UNSUPPORTED_ESM_URL_SCHEME. La CI tournant sur
// ubuntu-latest, ce garde ne s'exécutait tout simplement JAMAIS sur une machine
// de développement Windows. `pathToFileURL` donne un file:// valide partout.
const { MIGRATIONS } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'migrations.ts')).href)

const errors = []
const db = new DatabaseSync(dbPath)
try {
  const integ = db.prepare('PRAGMA integrity_check').all()
  if (!(integ.length === 1 && integ[0].integrity_check === 'ok')) errors.push('integrity_check en échec')
  const fk = db.prepare('PRAGMA foreign_key_check').all()
  if (fk.length > 0) errors.push(`foreign_key_check : ${fk.length} violation(s)`)

  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((t) => t.name)
  if (!tables.includes('_gf_migrations')) {
    errors.push('registre _gf_migrations ABSENT (modèle non baseliné — lancer scripts/baseline-template.mjs)')
  } else {
    const cols = db.prepare(`PRAGMA table_info("_gf_migrations")`).all().map((c) => c.name)
    for (const c of ['name', 'checksum', 'schemaVersion']) {
      if (!cols.includes(c)) errors.push(`registre : colonne ${c} manquante`)
    }
    const recorded = new Map(db.prepare('SELECT id, checksum FROM "_gf_migrations"').all().map((r) => [r.id, r.checksum]))
    const pending = MIGRATIONS.filter((m) => !recorded.has(m.id)).map((m) => m.id)
    if (pending.length > 0) errors.push(`baseline INCOMPLÈTE : ${pending.length} migration(s) en attente (${pending.slice(0, 3).join(', ')}…)`)
    for (const m of MIGRATIONS) {
      const rec = recorded.get(m.id)
      if (rec && rec !== migrationChecksum(m)) errors.push(`checksum divergent pour ${m.id} (définition modifiée après baseline)`)
    }
  }

  // Schéma final : aucune ancienne colonne monétaire Float.
  const OLD = [
    ['Garage', 'hourlyRate'], ['Part', 'unitCost'], ['Part', 'unitPrice'],
    ['JobPart', 'unitPrice'], ['JobPart', 'unitCost'],
    ['QuoteLine', 'quantity'], ['QuoteLine', 'unitPrice'], ['QuoteLine', 'unitCost'],
    ['InvoiceLine', 'quantity'], ['InvoiceLine', 'unitPrice'], ['InvoiceLine', 'unitCost'],
    ['LaborOperation', 'unitPrice'], ['LoanerReservation', 'dailyRate'],
    ['LoanerReservation', 'depositAmount'], ['WorkOrder', 'totalHT'], ['WorkOrder', 'totalTTC'],
    ['PurchaseOrder', 'totalHT'],
  ]
  for (const [t, c] of OLD) {
    if (!tables.includes(t)) continue
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((x) => x.name)
    if (cols.includes(c)) errors.push(`schéma NON final : ${t}.${c} (ancienne colonne Float) présente dans le modèle`)
  }
} finally {
  db.close()
}

if (errors.length) {
  console.error(`\n❌ Modèle SQLite : ${errors.length} problème(s) :`)
  for (const e of errors) console.error(`   • ${e}`)
  process.exit(1)
}
console.log(`✅ Modèle SQLite : intégrité + clés étrangères OK, baseline complète (${MIGRATIONS.length} migrations enregistrées, 0 en attente), checksums conformes, schéma final.`)
