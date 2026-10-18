#!/usr/bin/env node
/**
 * check-converge-additive.mjs — garde-fou de convergence de schéma Neon.
 *
 * `Invoke-ServerSchemaConverge` (scripts/reset-garageflow.ps1) réaligne le schéma
 * Neon Production AVANT déploiement via un DDL idempotent. Piège subtil : pour une
 * table matérialisée par `CREATE TABLE IF NOT EXISTS`, si la table PRÉEXISTE avec
 * un schéma plus ancien (colonne manquante), le CREATE est un NO-OP → la colonne
 * n'est jamais ajoutée, puis tout `CREATE INDEX ... (colonne)` échoue avec
 * « column "X" does not exist » et la rotation avorte (cas réel : EInvoiceEvent
 * sans "transmissionId").
 *
 * INVARIANT vérifié : toute colonne (hors clé primaire) d'une table créée par
 * `CREATE TABLE IF NOT EXISTS` dans le DDL de convergence DOIT aussi être couverte
 * par un `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. La convergence est alors
 * réellement ADDITIVE PAR COLONNE : elle répare le drift quel que soit l'état
 * antérieur de la table, avant de créer les index qui en dépendent.
 *
 * Usage : node scripts/check-converge-additive.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const PS1 = join(ROOT, 'scripts', 'reset-garageflow.ps1')

if (!existsSync(PS1)) { console.error(`❌ Script introuvable : ${PS1}`); process.exit(1) }
const text = readFileSync(PS1, 'utf8')

/**
 * Extrait le here-string PowerShell `@' … '@` contenant le DDL de convergence.
 * Le script contient plusieurs here-strings (ex. réparation legacyIdV*) : on
 * retient celui qui matérialise réellement les tables (`CREATE TABLE IF NOT EXISTS`).
 */
function extractConvergenceSql(src) {
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/@'\s*$/.test(lines[i])) {
      const body = []
      for (let j = i + 1; j < lines.length; j++) {
        if (/^'@/.test(lines[j])) break
        body.push(lines[j])
      }
      const text = body.join('\n')
      if (/CREATE TABLE IF NOT EXISTS/.test(text)) return text
    }
  }
  return null
}

const sql = extractConvergenceSql(text)
if (!sql) { console.error('❌ DDL de convergence ($sql = @\'…\'@) introuvable dans reset-garageflow.ps1'); process.exit(1) }

// 1. Tables créées par CREATE TABLE IF NOT EXISTS + leurs colonnes + clé primaire.
const createdTables = new Map() // table -> { columns: Set, pk: Set }
{
  const re = /CREATE TABLE IF NOT EXISTS\s+"(\w+)"\s*\(([\s\S]*?)\n\);/g
  let m
  while ((m = re.exec(sql))) {
    const table = m[1]
    const bodyLines = m[2].split('\n')
    const columns = new Set()
    const pk = new Set()
    for (const raw of bodyLines) {
      const line = raw.trim()
      const pkMatch = line.match(/PRIMARY KEY\s*\(([^)]*)\)/i)
      if (pkMatch) { for (const c of pkMatch[1].matchAll(/"(\w+)"/g)) pk.add(c[1]); continue }
      if (/^CONSTRAINT\b/i.test(line)) continue
      const col = line.match(/^"(\w+)"\s+/)
      if (col) columns.add(col[1])
    }
    createdTables.set(table, { columns, pk })
  }
}

// 2. Colonnes couvertes par ADD COLUMN IF NOT EXISTS.
const added = new Set() // `${table}.${col}`
for (const m of sql.matchAll(/ALTER TABLE\s+"(\w+)"\s+ADD COLUMN IF NOT EXISTS\s+"(\w+)"/g)) {
  added.add(`${m[1]}.${m[2]}`)
}

// 3. Colonnes référencées par un index (pour un message d'erreur ciblé).
const indexed = new Set() // `${table}.${col}`
for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX IF NOT EXISTS\s+"[^"]+"\s+ON\s+"(\w+)"\(([^)]*)\)/g)) {
  const table = m[1]
  for (const c of m[2].matchAll(/"(\w+)"/g)) indexed.add(`${table}.${c[1]}`)
}

// 4. Vérification de l'invariant.
const violations = []
for (const [table, { columns, pk }] of createdTables) {
  for (const col of columns) {
    if (pk.has(col)) continue // la PK existe toujours : aucun drift possible
    if (!added.has(`${table}.${col}`)) {
      violations.push({ table, col, indexed: indexed.has(`${table}.${col}`) })
    }
  }
}

if (violations.length) {
  console.error(`\n❌ Convergence NON additive par colonne : ${violations.length} colonne(s) sans ADD COLUMN IF NOT EXISTS.`)
  console.error('   Une table préexistante sans ces colonnes ne serait pas réparée → CREATE INDEX échoue à la rotation.\n')
  for (const v of violations) {
    console.error(`   • "${v.table}"."${v.col}"${v.indexed ? '  ⚠ INDEXÉE (échec direct « column does not exist »)' : ''}`)
  }
  console.error('\n   → Ajoutez `ALTER TABLE "…" ADD COLUMN IF NOT EXISTS "…" …;` après le CREATE TABLE, avant ses index.\n')
  process.exit(1)
}

const tableCount = createdTables.size
const colCount = [...createdTables.values()].reduce((n, t) => n + t.columns.size, 0)
console.log(`✅ Convergence additive par colonne : ${tableCount} tables CREATE-IF-NOT-EXISTS, ${colCount} colonnes toutes couvertes par ADD COLUMN.`)
